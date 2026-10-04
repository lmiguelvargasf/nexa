import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  githubClient,
  jsonArtifact,
  readJson,
  repositoryName,
  validationIdentity,
} from "./github.mjs";
import {
  assertIdentity,
  helperEligibility,
  parseLock,
  reviewIdentity,
  SHA,
  validateReview,
} from "./policy.mjs";

const ROOT = ".github/dependencies";
const WORKFLOW = ".github/workflows/dependency-merge-policy.yml";
export const CONTEXT = "Dependency merge policy";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 4_000_000 }).trim();
const safe = (text) =>
  String(text)
    .replace(/[\p{Cc}<>]/gu, " ")
    .slice(0, 1000);

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
  return (
    await client.api(
      `actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
    )
  ).workflow_runs;
}

export async function currentCI(client, pr, repository, token) {
  const candidates = await runs(client, "ci.yml", pr.head.ref);
  // Do not fall back to an older green run when a newer current-revision run failed.
  const run = candidates.find(
    (entry) =>
      entry.event === "pull_request" &&
      entry.head_repository?.full_name === pr.head.repo.full_name &&
      [pr.head.sha, pr.merge_commit_sha].includes(entry.head_sha),
  );
  if (
    run?.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error(
      "Latest current-revision CI is missing, running, or failed",
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
  for (const name of [
    "Validation scope",
    "Pre-PR validation",
    "Dependency validation",
  ])
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

export async function evaluate(
  client,
  repository,
  token,
  pr,
  branch,
  env,
  event,
  directory,
) {
  const {
    identity,
    commit,
    run: ci,
  } = await currentCI(client, pr, repository, token);
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
  assertIdentity(identity, pr, commit, repository);
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    "origin",
    identity.headSha,
    identity.baseSha,
  );
  const show = (sha, path) => git("show", `${sha}:${path}`);
  const eligibility = helperEligibility(
    {
      paths: git(
        "diff",
        "--name-only",
        `${identity.baseSha}...${identity.headSha}`,
      ).split("\n"),
      before: JSON.parse(show(identity.baseSha, "package.json")),
      after: JSON.parse(show(identity.headSha, "package.json")),
      oldLock: parseLock(show(identity.baseSha, "bun.lock")),
      newLock: parseLock(show(identity.headSha, "bun.lock")),
    },
    policy.helperAllowlist,
  );
  if (!eligibility.candidate) throw new Error(eligibility.reasons.join(" "));
  const reviews = await runs(client, "dependency-review.yml", branch);
  const reviewRun = reviews.find(
    (entry) =>
      entry.path === ".github/workflows/dependency-review.yml" &&
      entry.head_sha === pr.base.sha &&
      ["workflow_run", "workflow_dispatch"].includes(entry.event),
  );
  // Inspect the latest review attempt for this PR, not just a previous PASS.
  // Workflow runs aren't indexed by PR: use the trusted prepared identity artifact.
  for (const entry of reviews) {
    if (
      entry.path !== ".github/workflows/dependency-review.yml" ||
      entry.head_sha !== pr.base.sha ||
      !["workflow_run", "workflow_dispatch"].includes(entry.event)
    )
      continue;
    const input = await jsonArtifact(
      client,
      entry.id,
      token,
      repository,
      "dependency-review-input",
      "report.json",
    );
    if (input.identity?.prNumber !== pr.number) continue;
    if (
      !trustedRun(
        entry,
        ".github/workflows/dependency-review.yml",
        repository,
        pr.base.sha,
        branch,
      )
    )
      throw new Error("Latest review attempt is incomplete or failed");
    if (input.status === "DUPLICATE") continue;
    const report = await jsonArtifact(
      client,
      entry.id,
      token,
      repository,
      "dependency-review-result",
      "report.json",
    );
    assertReport(report, entry, identity, policy, key, JSON.parse(schemaText));
    return `Eligible helper minor/patch update; current CI ${ci.id} and Sol PASS ${entry.id}`;
  }
  throw new Error(
    reviewRun
      ? "No complete current PR review"
      : "No current trusted review run",
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
  let prs;
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const number = Number(event.inputs.pr_number);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Invalid PR number");
    prs = [await client.api(`pulls/${number}`)];
  } else if (event.pull_request)
    prs = [await client.api(`pulls/${event.pull_request.number}`)];
  else
    prs = await client.pages(
      `pulls?state=open&base=${encodeURIComponent(branch)}`,
    );
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
    const status = async (state, description) => {
      for (const sha of revisions)
        await client.api(`statuses/${sha}`, {
          method: "POST",
          body: {
            state,
            context: CONTEXT,
            description: safe(description).slice(0, 140),
            target_url: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
          },
        });
    };
    await status("pending", "Evaluating current CI and review evidence");
    let state = "failure";
    let reason;
    try {
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
      );
      const latest = await client.api(`pulls/${pr.number}`);
      const latestBase = (
        await client.api(`branches/${encodeURIComponent(branch)}`)
      ).commit.sha;
      if (
        latest.state !== "open" ||
        latest.draft ||
        latest.head.sha !== pr.head.sha ||
        latest.base.sha !== base ||
        latest.merge_commit_sha !== pr.merge_commit_sha ||
        latestBase !== base
      )
        throw new Error(
          "Revision changed during evaluation; rerun CI and approval",
        );
      state = "success";
    } catch (error) {
      reason = error.message;
    }
    await status(state, reason);
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `PR #${pr.number}: **${state}** — ${safe(reason)}\n\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await gate(process.argv[2]);
  } catch (error) {
    console.error(safe(error.message));
    process.exitCode = 1;
  }
}
