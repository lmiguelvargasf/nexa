import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchApplicability } from "./applicability.mjs";
import {
  githubClient,
  jsonArtifact,
  readJson,
  repositoryName,
  validationIdentity,
} from "./github.mjs";
import {
  assertIdentity,
  reviewIdentity,
  SHA,
  validateReview,
} from "./policy.mjs";

import {
  ACTIVE,
  eventTargets,
  latestAttempts,
  REVIEW_WORKFLOW,
  reviewTarget,
} from "./run-targets.mjs";

import { inspectUpdates, readUpdates } from "./updates.mjs";

const ROOT = ".github/dependencies";
const WORKFLOW = ".github/workflows/dependency-merge-policy.yml";
export const CONTEXT = "Dependency merge policy";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 4_000_000 }).trim();
const safe = (text) =>
  String(text)
    .replace(/[\p{Cc}<>]/gu, " ")
    .slice(0, 1000);

class WaitingForCI extends Error {}
class ObsoleteEvaluation extends Error {}

export function trustedRun(run, path, repository, baseSha, branch) {
  return (
    run.path === path &&
    run.head_repository?.full_name === repository &&
    run.head_sha === baseSha &&
    run.head_branch === branch &&
    ["workflow_run", "workflow_dispatch"].includes(run.event) &&
    run.status === "completed" &&
    run.conclusion === "success"
  );
}

export function assertReport(report, run, identity, policy, key, schema) {
  if (
    report.runId !== run.id ||
    (report.runAttempt ?? 1) !== (run.run_attempt ?? 1) ||
    report.key !== key ||
    report.status !== "PASS" ||
    report.complete !== true ||
    report.policy?.model !== policy.model ||
    report.policy?.effort !== policy.effort
  )
    throw new Error("Missing complete current PASS evidence");
  for (const field of [
    "repository",
    "prNumber",
    "headSha",
    "baseSha",
    "testedSha",
  ])
    if (report.identity?.[field] !== identity[field])
      throw new Error("Stale review identity");
  const result = validateReview(
    JSON.stringify(report.result),
    schema,
    identity,
    report.complete,
    policy.maxResultBytes,
  );
  if (result.decision !== "PASS")
    throw new Error("AI decision requires a human");
}

export async function authorizedHuman(client, user) {
  if (user?.type !== "User" || !/^[A-Za-z0-9-]+$/.test(user.login ?? ""))
    return false;
  const permission = await client.api(
    `collaborators/${encodeURIComponent(user.login)}/permission`,
  );
  return ["admin", "maintain", "write"].includes(permission.permission);
}

async function runs(client, workflow, branch) {
  // A bounded lookup. Missing/older evidence blocks and requires an intentional rerun.
  return latestAttempts(
    (
      await client.api(
        `actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
      )
    ).workflow_runs,
  );
}

export async function currentCI(client, pr, repository, token, guards = []) {
  const candidates = await runs(client, "ci.yml", pr.head.ref);
  // Do not fall back to an older green run when a newer current-revision run failed.
  const run = candidates.find(
    (entry) =>
      entry.event === "pull_request" &&
      entry.head_repository?.full_name === pr.head.repo.full_name &&
      [pr.head.sha, pr.merge_commit_sha].includes(entry.head_sha),
  );
  const stamp = runStamp(run);
  guards.push(async () => {
    const latest = (await runs(client, "ci.yml", pr.head.ref)).find(
      (entry) =>
        entry.event === "pull_request" &&
        entry.head_repository?.full_name === pr.head.repo.full_name &&
        [pr.head.sha, pr.merge_commit_sha].includes(entry.head_sha),
    );
    if (runStamp(latest) !== stamp)
      throw new ObsoleteEvaluation(
        "CI changed during evaluation; obsolete decision publication skipped",
      );
  });
  if (!run) throw new WaitingForCI("Waiting for current-revision CI to start");
  if (run.path !== ".github/workflows/ci.yml")
    throw new Error(
      "Latest current-revision CI has an unexpected workflow path",
    );
  if (
    ["requested", "queued", "pending", "waiting", "in_progress"].includes(
      run.status,
    )
  )
    throw new WaitingForCI(
      `Waiting for current-revision CI to finish (${run.status})`,
    );
  if (run.status !== "completed" || run.conclusion !== "success")
    throw new Error(
      `Latest current-revision CI did not succeed (${run.conclusion ?? run.status ?? "unknown"})`,
    );
  const identity = await validationIdentity(client, run.id, token, repository);
  const commit = await client.api(`commits/${identity.testedSha}`);
  assertIdentity(identity, pr, commit, repository, false);
  if (identity.testedSha !== pr.merge_commit_sha) {
    // GitHub can regenerate a test merge with a new timestamp. Reuse CI only
    // when both exact parents and the complete Git tree still match.
    if (!SHA.test(pr.merge_commit_sha ?? ""))
      throw new Error("Missing current GitHub merge revision");
    const current = await client.api(`commits/${pr.merge_commit_sha}`);
    assertIdentity(
      { ...identity, testedSha: pr.merge_commit_sha },
      pr,
      current,
      repository,
      false,
    );
    const tree = commit.commit?.tree?.sha;
    if (!SHA.test(tree ?? "") || current.commit?.tree?.sha !== tree)
      throw new Error("Current merge content differs from the CI-tested tree");
  }
  const { jobs } = await client.api(`actions/runs/${run.id}/jobs?per_page=100`);
  for (const name of ["Validation scope", "Pre-PR validation", "CI validation"])
    if (
      !jobs.some(
        (job) =>
          job.name === name &&
          job.status === "completed" &&
          job.conclusion === "success",
      )
    )
      throw new Error(`Required CI job missing or failed: ${name}`);
  return { identity, commit, run };
}

async function humanApproval(client, repository, token, pr, branch, key) {
  const candidates = await runs(client, "dependency-merge-policy.yml", branch);
  for (const run of candidates) {
    if (
      run.event !== "workflow_dispatch" ||
      !trustedRun(run, WORKFLOW, repository, pr.base.sha, branch)
    )
      continue;
    const { artifacts } = await client.api(
      `actions/runs/${run.id}/artifacts?per_page=100`,
    );
    if (
      !artifacts.some(
        (entry) => entry.name === "dependency-human-approval" && !entry.expired,
      )
    )
      continue;
    const approval = await jsonArtifact(
      client,
      run.id,
      token,
      repository,
      "dependency-human-approval",
      "approval.json",
      8192,
    );
    if (
      approval.runId !== run.id ||
      approval.key !== key ||
      approval.repository !== repository ||
      approval.prNumber !== pr.number ||
      approval.headSha !== pr.head.sha ||
      approval.baseSha !== pr.base.sha ||
      approval.actor !== (run.triggering_actor ?? run.actor)?.login
    )
      continue;
    if (await authorizedHuman(client, run.triggering_actor ?? run.actor))
      return approval.actor;
  }
  return null;
}

const runStamp = (run) =>
  JSON.stringify(
    run && [
      run.id,
      run.run_attempt ?? 1,
      run.status,
      run.conclusion,
      run.run_started_at,
    ],
  );

async function relevantReview(client, repository, token, pr, branch, identity) {
  for (const entry of await runs(client, "dependency-review.yml", branch)) {
    if (
      entry.path !== REVIEW_WORKFLOW ||
      entry.head_sha !== pr.base.sha ||
      !["workflow_run", "workflow_dispatch"].includes(entry.event)
    )
      continue;
    if (
      (await reviewTarget(
        client,
        entry,
        repository,
        branch,
        token,
        identity,
      )) === pr.number
    )
      return entry;
  }
  return null;
}

export async function evaluate(
  client,
  repository,
  token,
  pr,
  branch,
  env,
  event,
  directory,
  guards = [],
) {
  const applicability = fetchApplicability({
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
  });
  if (!applicability.applicable)
    return "Not applicable: no dependency changes; CI validation remains required";
  const {
    identity,
    commit,
    run: ci,
  } = await currentCI(client, pr, repository, token, guards);
  const policy = readJson(`${ROOT}/policy.json`);
  const schemaText = readFileSync(`${ROOT}/review-schema.json`, "utf8");
  const key = reviewIdentity(
    identity,
    policy,
    readFileSync(`${ROOT}/review-prompt.md`, "utf8"),
    schemaText,
    readFileSync(`${ROOT}/codex.toml`, "utf8"),
  );
  // Manual approval is an explicit review attestation of both current revisions.
  // It cannot bypass CI. Author approval is supported for solo-maintainer repos.
  if (
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    event.inputs.approve === "true"
  ) {
    const execution = await client.api(`actions/runs/${env.GITHUB_RUN_ID}`);
    if (
      env.GITHUB_REF !== `refs/heads/${branch}` ||
      execution.path !== WORKFLOW ||
      execution.event !== "workflow_dispatch" ||
      execution.head_sha !== pr.base.sha ||
      execution.head_branch !== branch ||
      execution.head_repository?.full_name !== repository ||
      event.inputs.expected_head !== pr.head.sha ||
      event.inputs.expected_base !== pr.base.sha ||
      !(await authorizedHuman(
        client,
        execution.triggering_actor ?? execution.actor,
      ))
    )
      throw new Error(
        "Manual approval requires a write-authorized human and exact current head/base on the default branch",
      );
    const actor = (execution.triggering_actor ?? execution.actor).login;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "approval.json"),
      `${JSON.stringify(
        {
          key,
          runId: Number(env.GITHUB_RUN_ID),
          repository,
          prNumber: pr.number,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          actor,
        },
        null,
        2,
      )}\n`,
    );
    return `Human approval by ${actor}; current CI ${ci.id} passed`;
  }
  const human = await humanApproval(client, repository, token, pr, branch, key);
  if (human) return `Human approval by ${human}; current CI ${ci.id} passed`;
  if (policy.automaticMerging !== true || env.AUTOMERGE_ENABLED !== "true")
    throw new Error(
      "Supervised mode: explicit human review approval is required",
    );
  try {
    assertIdentity(identity, pr, commit, repository);
  } catch (error) {
    throw new Error(
      `Requires explicit human review approval; automatic review unavailable: ${error.message}`,
    );
  }
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    "origin",
    identity.headSha,
    identity.baseSha,
  );
  const eligibility = inspectUpdates(readUpdates(identity));
  if (!eligibility.candidate) throw new Error(eligibility.reasons.join(" "));
  const firstReview = await relevantReview(
    client,
    repository,
    token,
    pr,
    branch,
    identity,
  );
  guards.push(async () => {
    const latest = await relevantReview(
      client,
      repository,
      token,
      pr,
      branch,
      identity,
    );
    if (runStamp(latest) !== runStamp(firstReview))
      throw new ObsoleteEvaluation(
        "Review changed during evaluation; obsolete decision publication skipped",
      );
  });
  const reviews = await runs(client, "dependency-review.yml", branch);
  for (const entry of reviews) {
    if (
      entry.path !== REVIEW_WORKFLOW ||
      entry.head_sha !== pr.base.sha ||
      !["workflow_run", "workflow_dispatch"].includes(entry.event)
    )
      continue;
    const target = await reviewTarget(
      client,
      entry,
      repository,
      branch,
      token,
      identity,
    );
    if (target !== pr.number) continue;
    if (ACTIVE.includes(entry.status))
      throw new WaitingForCI(
        `Waiting for current PR dependency review to finish (${entry.status})`,
      );
    const input = await jsonArtifact(
      client,
      entry.id,
      token,
      repository,
      "dependency-review-input",
      "report.json",
    );
    if (
      input.runId !== entry.id ||
      (input.runAttempt ?? 1) !== (entry.run_attempt ?? 1) ||
      input.identity?.repository !== repository ||
      input.identity?.prNumber !== pr.number
    )
      throw new Error("Prepared review identity has invalid provenance");
    // A valid old revision is unrelated to the exact current review identity.
    for (const field of ["headSha", "baseSha", "testedSha"])
      if (!SHA.test(input.identity[field] ?? ""))
        throw new Error("Malformed prepared review identity");
    if (
      ["headSha", "baseSha", "testedSha"].some(
        (field) => input.identity[field] !== identity[field],
      )
    )
      continue;
    if (!trustedRun(entry, REVIEW_WORKFLOW, repository, pr.base.sha, branch))
      throw new Error(
        `Latest PR review attempt failed (${entry.conclusion ?? entry.status}); rerun review or complete human review`,
      );
    if (input.key !== key)
      throw new Error("Review policy changed; request a fresh review");
    if (input.status === "DUPLICATE") continue;
    if (["DISABLED", "NEEDS_HUMAN", "ERROR", "BLOCK"].includes(input.status))
      throw new Error(
        `Dependency review ${input.status}: ${input.reason ?? "complete explicit human review or rerun after fixing evidence/setup"}`,
      );
    const report = await jsonArtifact(
      client,
      entry.id,
      token,
      repository,
      "dependency-review-result",
      "report.json",
    );
    if (report.status !== "PASS")
      throw new Error(
        `Dependency review ${report.status ?? "invalid"}: ${report.reason ?? "explicit human review or a fresh complete PASS is required"}`,
      );
    assertReport(report, entry, identity, policy, key, JSON.parse(schemaText));
    return `Eligible dependency minor/patch or pin update; current CI ${ci.id} and Sol PASS ${entry.id}`;
  }
  throw new Error(
    "No complete current PR review; request a fresh dependency review",
  );
}

export async function gate(directory, env = process.env) {
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  const client = githubClient(repository, env.GH_TOKEN);
  const event = readJson(env.GITHUB_EVENT_PATH);
  const repo = await client.api("");
  const branch = repo.default_branch;
  if (
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REF !== `refs/heads/${branch}`
  )
    throw new Error("Run the trusted workflow on the default branch");
  const base = (await client.api(`branches/${encodeURIComponent(branch)}`))
    .commit.sha;
  if (git("rev-parse", "HEAD") !== base)
    throw new Error(
      "Trusted policy checkout is stale; rerun on current default branch",
    );
  // Old queued workflow definitions may check out the newly deployed scripts.
  // They lack the per-PR matrix lock and must never remain status publishers.
  if (
    env.GITHUB_ACTIONS === "true" &&
    env.PLAN_ONLY !== "true" &&
    !env.TARGET_PR
  )
    throw new Error(
      "Obsolete workflow lacks the per-PR publication lock; rerun the current workflow",
    );
  const targets = env.TARGET_PR
    ? [Number(env.TARGET_PR)]
    : await eventTargets(client, repository, branch, env, event, env.GH_TOKEN);
  if (targets.some((number) => !Number.isSafeInteger(number) || number < 1))
    throw new Error("Invalid resolved PR number");
  if (env.PLAN_ONLY === "true") {
    appendFileSync(env.GITHUB_OUTPUT, `prs=${JSON.stringify(targets)}\n`);
    return [];
  }
  const prs = [];
  for (const number of targets) prs.push(await client.api(`pulls/${number}`));
  const decisions = [];
  for (const pr of prs) {
    if (pr.state !== "open" || pr.base.ref !== branch) continue;
    if (!SHA.test(pr.head.sha)) throw new Error("Invalid PR head");
    // Publish on both revisions so GitHub's head/test-merge precedence cannot
    // select a missing context. CI must match this merge's parents and tree.
    const revisions = [
      ...new Set(
        [pr.head.sha, pr.merge_commit_sha].filter((sha) => SHA.test(sha ?? "")),
      ),
    ];
    const fresh = async () => {
      const latest = await client.api(`pulls/${pr.number}`);
      const latestBase = (
        await client.api(`branches/${encodeURIComponent(branch)}`)
      ).commit.sha;
      if (
        latest.state !== "open" ||
        latest.draft !== pr.draft ||
        latest.head.sha !== pr.head.sha ||
        latest.base.sha !== pr.base.sha ||
        latest.merge_commit_sha !== pr.merge_commit_sha ||
        latestBase !== base
      )
        throw new ObsoleteEvaluation(
          "Revision changed during evaluation; obsolete status publication skipped",
        );
    };
    const guards = [];
    const status = async (state, description, checkEvidence = false) => {
      // Every publisher (including base/bulk refreshes) holds the same per-PR
      // Actions concurrency lock. Check freshness before EACH head/merge write,
      // including failures and pending; an old base must never touch a new head.
      for (const sha of revisions) {
        if (checkEvidence) for (const guard of guards) await guard();
        await fresh();
        await client.api(`statuses/${sha}`, {
          method: "POST",
          body: {
            state,
            context: CONTEXT,
            description: safe(description).slice(0, 140),
            target_url: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
          },
        });
      }
    };
    let state = "failure";
    let reason;
    try {
      await status(
        "pending",
        "Checking dependency applicability for current revisions",
      );
      if (pr.draft || pr.base.sha !== base)
        throw new Error("Draft PR or stale base revision");
      reason = await evaluate(
        client,
        repository,
        env.GH_TOKEN,
        pr,
        branch,
        env,
        event,
        directory,
        guards,
      );
      await fresh();
      state = "success";
    } catch (error) {
      if (error instanceof WaitingForCI) state = "pending";
      reason = error.message;
    }
    try {
      await status(state, reason, true);
    } catch (error) {
      if (!(error instanceof ObsoleteEvaluation)) throw error;
      console.log(`PR #${pr.number}: obsolete evaluation skipped`);
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `PR #${pr.number}: obsolete evaluation skipped; current revision activity will reevaluate.\n`,
      );
      decisions.push({
        prNumber: pr.number,
        state: "obsolete",
        reason: error.message,
      });
      continue;
    }
    const message = `PR #${pr.number}: ${state} — ${safe(reason)}`;
    console.log(message);
    if (state !== "success")
      console.log(
        `::${state === "failure" ? "error" : "notice"}::${message.replaceAll("%", "%25")}`,
      );
    const approvalInstructions =
      state === "failure"
        ? `After resolving any CI/evidence failures and personally reviewing this exact revision, a write-authorized human can approve through [Evaluate dependency merge policy](https://github.com/${repository}/actions/workflows/dependency-merge-policy.yml) on \`${branch}\`, with \`pr_number=${pr.number}\`, \`approve=true\`, \`expected_head=${pr.head.sha}\`, and \`expected_base=${pr.base.sha}\`. Human approval does not waive CI or repository protection.\n\n`
        : state === "pending"
          ? "The evaluator finished; the required Dependency merge policy status remains pending and blocks merging until current CI/review completes. Completion triggers a fresh evaluation.\n\n"
          : "";
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `PR #${pr.number}: **${state}** — ${safe(reason)}\n\n${approvalInstructions}`,
    );
    decisions.push({ prNumber: pr.number, state, reason });
  }
  return decisions;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const decisions = await gate(process.argv[2]);
    // Publish every PR decision before failing the evaluator workflow. Pending
    // is a normal wait; only successful statuses authorize the required gate.
    if (decisions.some(({ state }) => state === "failure"))
      process.exitCode = 1;
  } catch (error) {
    console.error(safe(error.message));
    process.exitCode = 1;
  }
}
