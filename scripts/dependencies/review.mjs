import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchApplicability } from "./applicability.mjs";
import {
  githubClient,
  readJson,
  releaseEvidence,
  repositoryName,
  upstreamEvidence,
  validationIdentity,
} from "./github.mjs";
import {
  assertIdentity,
  dependencyChanges,
  estimateCost,
  lockedChanges,
  parseLock,
  reviewIdentity,
  SHA,
  stable,
  usageFromEvents,
  validateReview,
} from "./policy.mjs";

import { inspectUpdates, readUpdates } from "./updates.mjs";

const ROOT = ".github/dependencies";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 4_000_000 }).trim();
const output = (key, value) =>
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
const save = (directory, name, data) =>
  writeFileSync(join(directory, name), `${JSON.stringify(data, null, 2)}\n`);
const safeText = (value) =>
  String(value)
    .replace(/[\p{Cc}<>]/gu, " ")
    .slice(0, 1000);

export function summary(report) {
  const { identity, policy, result, usage, cost } = report;
  return [
    `<!-- dependency-review:${report.key} run:${report.runId} -->`,
    policy.automaticMerging
      ? "**Dependency review — the trusted merge policy decides eligibility.**"
      : "**Dependency review — supervised; automatic merging is disabled.**",
    `Result: **${report.status}**. ${safeText(report.reason ?? result?.summary ?? "")}`,
    `Model: \`${policy.model}\`; effort: \`${policy.effort}\`; processing: standard.`,
    `Reviewed head: \`${identity.headSha}\`; base: \`${identity.baseSha}\`; tested merge: \`${identity.testedSha}\`.`,
    `Automatic merge candidate: **${report.eligibility?.candidate ? "yes" : "no"}**.`,
    ...(report.eligibility?.reasons ?? []).map(
      (reason) => `- ${safeText(reason)}`,
    ),
    ...(result?.findings ?? []).map(
      (finding) => `- Finding: ${safeText(finding)}`,
    ),
    ...(result?.uncertainties ?? []).map(
      (uncertainty) => `- Uncertainty: ${safeText(uncertainty)}`,
    ),
    ...(result?.evidence ?? []).map(
      (evidence) => `- Evidence: ${safeText(evidence)}`,
    ),
    usage
      ? `Tokens: input ${usage.input}, cached ${usage.cachedInput}, output ${usage.output} (includes ${usage.reasoning} reasoning). Estimated token cost: $${cost.toFixed(4)}.`
      : "Token usage/cost unavailable; check the dedicated API project's usage. A failure may still have incurred cost.",
    policy.automaticMerging
      ? "CI remains required. Only the trusted merge policy can authorize an eligible dependency update."
      : "CI remains required. Review this update manually; AI output never authorizes a merge during the pilot.",
  ].join("\n\n");
}

export async function prepare(directory, env = process.env) {
  mkdirSync(directory, { recursive: true });
  output("policy_sha", git("rev-parse", "HEAD"));
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  const client = githubClient(repository, env.GH_TOKEN);
  const event = readJson(env.GITHUB_EVENT_PATH);
  const dispatch = env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const number = dispatch
    ? Number(event.inputs.pr_number)
    : event.workflow_run.pull_requests?.[0]?.number;
  let prNumber = number;
  if (!dispatch && !prNumber) {
    const branch = event.workflow_run.head_branch;
    const owner = repository.split("/")[0];
    const matches = await client.api(
      `pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    if (matches.length !== 1)
      throw new Error("Cannot uniquely associate CI with an open PR");
    prNumber = matches[0].number;
  }
  if (!Number.isSafeInteger(prNumber) || prNumber < 1)
    throw new Error("Invalid PR number");
  const pr = await client.api(`pulls/${prNumber}`);
  const repo = await client.api("");
  if (pr.base.ref !== repo.default_branch)
    throw new Error(
      "Reviewer only supports the repository's default base branch",
    );
  // Ordinary changes never enter dependency evidence preparation, even when
  // dispatched manually or carried on a Renovate-named branch.
  const applicability = fetchApplicability({
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
  });
  if (!applicability.applicable) {
    output("ready", "false");
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `PR #${prNumber}: dependency review not applicable; no dependency changes. No AI review performed.\n`,
    );
    return;
  }
  let runId;
  if (dispatch) {
    const runs = await client.api(
      `actions/workflows/ci.yml/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}&per_page=100`,
    );
    runId = runs.workflow_runs.find(
      (run) =>
        run.head_sha === pr.head.sha &&
        run.status === "completed" &&
        run.conclusion === "success",
    )?.id;
  } else runId = event.workflow_run.id;
  if (!Number.isSafeInteger(runId))
    throw new Error("No successful PR CI run; rerun CI first");
  const run = await client.api(`actions/runs/${runId}`);
  if (
    run.event !== "pull_request" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_repository?.full_name !== repository
  ) {
    throw new Error(
      "Only successful, same-repository PR CI can trigger a paid review",
    );
  }
  const identity = await validationIdentity(
    client,
    runId,
    env.GH_TOKEN,
    repository,
  );
  const commit = await client.api(`commits/${identity.testedSha}`);
  assertIdentity(identity, pr, commit, repository);
  if (![identity.headSha, identity.testedSha].includes(run.head_sha))
    throw new Error("CI head mismatch");
  const jobs = await client.api(`actions/runs/${runId}/jobs?per_page=100`);
  for (const name of [
    "Validation scope",
    "Pre-PR validation",
    "CI validation",
  ]) {
    if (
      !jobs.jobs.some(
        (job) =>
          job.name === name &&
          job.status === "completed" &&
          job.conclusion === "success",
      )
    )
      throw new Error(`Required CI job missing or failed: ${name}`);
  }
  const policy = readJson(`${ROOT}/policy.json`);
  if (
    policy.mode !== (policy.automaticMerging ? "automatic" : "supervised") ||
    policy.model !== "gpt-6.1-sol" ||
    policy.effort !== "medium" ||
    policy.serviceTier !== "default"
  )
    throw new Error("Unexpected review policy");
  const prompt = readFileSync(`${ROOT}/review-prompt.md`, "utf8");
  const schema = readFileSync(`${ROOT}/review-schema.json`, "utf8");
  const config = readFileSync(`${ROOT}/codex.toml`, "utf8");
  const key = reviewIdentity(identity, policy, prompt, schema, config);
  const report = {
    key,
    identity,
    policy,
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1),
    ciRunId: runId,
    status: "NEEDS_HUMAN",
    complete: false,
  };
  save(directory, "report.json", report);
  output("pr_number", prNumber);
  output("ready", "false");
  const comments = await client.pages(`issues/${prNumber}/comments`);
  const previous = comments.find(
    (comment) =>
      comment.user.login === "github-actions[bot]" &&
      comment.body.startsWith(`<!-- dependency-review:${key} `),
  );
  if (previous && !(dispatch && event.inputs.force === "true")) {
    report.status = "DUPLICATE";
    report.reason =
      "This exact review identity has already been reported. Use the documented manual force rerun if necessary.";
    save(directory, "report.json", report);
    return;
  }
  if (env.AI_ENABLED !== "true" || env.API_CONFIGURED !== "true") {
    report.status = "DISABLED";
    report.reason =
      env.AI_ENABLED !== "true"
        ? "Set DEPENDENCY_AI_REVIEW_ENABLED=true after completing the pilot setup."
        : "OPENAI_API_KEY is missing; configure the dedicated funded project secret.";
    save(directory, "report.json", report);
    return;
  }
  const files = await client.pages(`pulls/${prNumber}/files`);
  if (files.length > 80 || files.some((file) => file.status !== "modified")) {
    report.reason =
      "Added, removed, renamed, or oversized file set requires human review; no paid review performed.";
    save(directory, "report.json", report);
    return;
  }
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    "origin",
    identity.headSha,
    identity.baseSha,
  );
  const show = (sha, path) => git("show", `${sha}:${path}`);
  const snapshot = readUpdates(identity);
  const before = JSON.parse(
    snapshot.before["package.json"] ?? show(identity.baseSha, "package.json"),
  );
  const after = JSON.parse(
    snapshot.after["package.json"] ?? show(identity.headSha, "package.json"),
  );
  const oldLock = parseLock(
    snapshot.before["bun.lock"] ?? show(identity.baseSha, "bun.lock"),
  );
  const newLock = parseLock(
    snapshot.after["bun.lock"] ?? show(identity.headSha, "bun.lock"),
  );
  const declaredChanges = dependencyChanges(before, after);
  report.eligibility = inspectUpdates(snapshot);
  let changes;
  try {
    changes = report.eligibility.changes.map((change) =>
      change.manager === "bun"
        ? { ...lockedChanges([change], oldLock, newLock)[0], manager: "bun" }
        : change,
    );
  } catch (error) {
    report.reason = `${error.message}; human review required without a paid run.`;
    save(directory, "report.json", report);
    return;
  }
  if (
    !report.eligibility.candidate ||
    !changes.length ||
    changes.length > policy.maxChangedPackages
  ) {
    report.reason =
      report.eligibility.reasons.join(" ") ||
      "Too many changed dependencies; review manually without a paid run.";
    save(directory, "report.json", report);
    return;
  }
  const evidence = {
    identity,
    eligibility: report.eligibility,
    changes,
    ci: {
      runId,
      conclusion: run.conclusion,
      testedMerge: {
        sha: commit.sha,
        parents: commit.parents.map(({ sha }) => sha),
        relationshipValidated: true,
      },
      checks: jobs.jobs.map(({ name, conclusion, steps = [] }) => ({
        name,
        conclusion,
        steps: steps.map(({ name, conclusion }) => ({ name, conclusion })),
      })),
      trustedBaselineWorkflow: {
        path: ".github/workflows/ci.yml",
        revision: git("rev-parse", "HEAD"),
        content: readFileSync(".github/workflows/ci.yml", "utf8"),
      },
    },
    lockfile: {
      directEntries: declaredChanges.map(({ name }) => ({
        name,
        before:
          oldLock.packages[name] ??
          Object.entries(oldLock.packages).filter(([, entry]) =>
            entry[0]?.startsWith(`${name}@`),
          ),
        after:
          newLock.packages[name] ??
          Object.entries(newLock.packages).filter(([, entry]) =>
            entry[0]?.startsWith(`${name}@`),
          ),
      })),
      changedPackages: [
        ...new Set([
          ...Object.keys(oldLock.packages),
          ...Object.keys(newLock.packages),
        ]),
      ]
        .sort()
        .filter(
          (name) =>
            JSON.stringify(stable(oldLock.packages[name])) !==
            JSON.stringify(stable(newLock.packages[name])),
        )
        .map((name) => ({
          name,
          before: oldLock.packages[name] ?? null,
          after: newLock.packages[name] ?? null,
        })),
    },
    diff: git(
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      `${identity.baseSha}...${identity.headSha}`,
      "--",
      ...files.map((file) => file.filename),
    ),
    usage: [],
    releases: [],
    missing: [],
  };
  const sourcePaths = new Set(
    git(
      "ls-tree",
      "-r",
      "--name-only",
      identity.headSha,
      "--",
      "src",
      "emails",
      "e2e",
    ).split("\n"),
  );
  for (const change of changes) {
    try {
      // Tooling/config consumers are usage too; an application import is not
      // required for a compiler, linter, runtime, CLI or workflow Action.
      const names =
        change.manager === "mise"
          ? ""
          : git(
              "grep",
              "-l",
              "-F",
              change.name,
              identity.headSha,
              "--",
              "src",
              "emails",
              "e2e",
              "Taskfile.yml",
              "package.json",
              "*.config.*",
              ".github/workflows",
            );
      const paths = new Set(
        names
          .split("\n")
          .filter(Boolean)
          .map((name) => name.slice(41)),
      );
      if (change.manager === "mise") {
        for (const path of git(
          "ls-tree",
          "-r",
          "--name-only",
          identity.headSha,
          "--",
          "Taskfile.yml",
          "package.json",
          ".github/workflows",
        )
          .split("\n")
          .filter(Boolean))
          paths.add(path);
      }
      if (change.manager === "mise") paths.add("mise.toml");
      if (change.manager === "mise") {
        for (const path of ["mise.lock", "README.md", "scripts/setup.sh"])
          if (git("ls-tree", "--name-only", identity.headSha, "--", path))
            paths.add(path);
        if (change.name === "prek")
          for (const path of ["prek.toml", "scripts/skills/update.mjs"])
            if (git("ls-tree", "--name-only", identity.headSha, "--", path))
              paths.add(path);
      }
      if (change.manager === "github-actions") paths.add(change.path);
      for (const path of [...paths]) {
        const stem = path.replace(/\.[jt]sx?$/, "");
        for (const suffix of [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"])
          if (sourcePaths.has(`${stem}${suffix}`))
            paths.add(`${stem}${suffix}`);
      }
      // The full manifest and changed workflows already appear in the diff.
      // Supply focused consumers first, retaining the same bounded budget.
      for (const path of paths) {
        if (!evidence.usage.some((entry) => entry.path === path))
          evidence.usage.push({ path, content: show(identity.headSha, path) });
      }
      if (!paths.size) throw new Error("No dependency consumers found");
    } catch {
      evidence.missing.push(
        `${change.name}: complete dependency usage unavailable.`,
      );
    }
    try {
      evidence.releases.push(
        await (change.manager === "bun" ? releaseEvidence : upstreamEvidence)(
          change,
          policy.maxReleaseBytes,
          (upstream) => githubClient(upstream, env.GH_TOKEN),
        ),
      );
    } catch (error) {
      evidence.missing.push(`${change.name}: ${error.message}`);
    }
  }
  const bundle = `${prompt}\n\nUNTRUSTED EVIDENCE (JSON):\n${JSON.stringify(evidence, null, 2)}\n`;
  if (
    Buffer.byteLength(bundle) > policy.maxContextBytes ||
    evidence.missing.length
  ) {
    report.reason =
      Buffer.byteLength(bundle) > policy.maxContextBytes
        ? "Evidence exceeds the context byte limit; no truncated review performed."
        : evidence.missing.join(" ");
    save(directory, "report.json", report);
    return;
  }
  report.complete = true;
  report.status = "PENDING";
  save(directory, "report.json", report);
  writeFileSync(join(directory, "prompt.md"), bundle);
  writeFileSync(join(directory, "schema.json"), schema);
  mkdirSync(join(directory, "workspace"), { recursive: true });
  execFileSync("git", ["init", "--quiet", join(directory, "workspace")]);
  mkdirSync(join(directory, "codex-home"), { recursive: true });
  writeFileSync(join(directory, "codex-home", "config.toml"), config);
  output("ready", "true");
}

export function collectUsage(directory) {
  const found = [];
  const visit = (path) => {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return;
    if (lstatSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    } else if (path.endsWith(".jsonl") && lstatSync(path).size <= 4_000_000) {
      const events = readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return {};
          }
        });
      const usage = usageFromEvents(events);
      if (usage) found.push(usage);
    }
  };
  visit(join(directory, "sessions"));
  if (!found.length) return null;
  return found.reduce(
    (sum, entry) =>
      Object.fromEntries(
        Object.keys(entry).map((key) => [key, sum[key] + entry[key]]),
      ),
    { input: 0, cachedInput: 0, output: 0, reasoning: 0 },
  );
}

export function finish(directory, outcome) {
  const report = readJson(join(directory, "report.json"));
  if (report.status === "PENDING") {
    try {
      if (outcome !== "success")
        throw new Error(
          `Reviewer ${outcome || "missing"}; check the Action log for credential, quota, timeout, or API errors. No automatic retry.`,
        );
      report.result = validateReview(
        readFileSync(join(directory, "result.json"), "utf8"),
        readJson(`${ROOT}/review-schema.json`),
        report.identity,
        report.complete,
        report.policy.maxResultBytes,
      );
      report.status = report.result.decision;
    } catch (error) {
      report.status = "ERROR";
      report.reason = error.message;
    }
    report.usage = collectUsage(join(directory, "codex-home"));
    report.cost = estimateCost(
      report.usage,
      report.policy.pricesPerMillionTokens,
    );
  }
  save(directory, "report.json", report);
  writeFileSync(join(directory, "summary.md"), `${summary(report)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary(report)}\n`);
  return report;
}

export async function publish(directory, env = process.env) {
  const report = readJson(join(directory, "report.json"));
  if (report.status === "DUPLICATE") return;
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  const client = githubClient(repository, env.GH_TOKEN);
  const pr = await client.api(`pulls/${report.identity.prNumber}`);
  const commit = await client.api(`commits/${report.identity.testedSha}`);
  assertIdentity(report.identity, pr, commit, repository);
  // Never post stale feedback against a changed head/base or a different policy.
  const key = reviewIdentity(
    report.identity,
    readJson(`${ROOT}/policy.json`),
    readFileSync(`${ROOT}/review-prompt.md`, "utf8"),
    readFileSync(`${ROOT}/review-schema.json`, "utf8"),
    readFileSync(`${ROOT}/codex.toml`, "utf8"),
  );
  if (key !== report.key)
    throw new Error(
      "Review policy changed; rerun against the current trusted policy",
    );
  if (!SHA.test(report.identity.headSha))
    throw new Error("Invalid review report");
  const comments = await client.pages(`issues/${pr.number}/comments`);
  const existing = comments.find(
    (comment) =>
      comment.user.login === "github-actions[bot]" &&
      comment.body.startsWith(`<!-- dependency-review:${key} `),
  );
  const previousRun = Number(existing?.body.match(/ run:(\d+) -->/)?.[1] ?? 0);
  if (previousRun > report.runId) return;
  const body = summary(report);
  await client.api(
    existing
      ? `issues/comments/${existing.id}`
      : `issues/${pr.number}/comments`,
    { method: existing ? "PATCH" : "POST", body: { body } },
  );
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${body}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, directory] = process.argv.slice(2);
  try {
    if (command === "prepare") await prepare(directory);
    else if (command === "finish")
      finish(directory, process.env.REVIEW_OUTCOME);
    else if (command === "publish") await publish(directory);
    else throw new Error("Use prepare, finish, or publish");
  } catch (error) {
    // A preparation failure can follow PR identity verification. Preserve that
    // report for human feedback; never turn the failure into a paid run or PASS.
    if (command === "prepare" && existsSync(join(directory, "report.json"))) {
      const report = readJson(join(directory, "report.json"));
      report.status = "ERROR";
      report.reason = error.message;
      save(directory, "report.json", report);
    }
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Dependency review stopped: ${safeText(error.message)}\n`,
      );
    console.error(safeText(error.message));
    process.exitCode = 1;
  }
}
