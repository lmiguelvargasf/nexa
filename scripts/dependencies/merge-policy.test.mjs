import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertReport,
  authorizedHuman,
  gate,
  trustedRun,
} from "./merge-policy.mjs";
import { reviewIdentity } from "./policy.mjs";

const policyRoot = new URL("../../.github/dependencies/", import.meta.url);
const repository = "owner/template";
const workflow = ".github/workflows/dependency-merge-policy.yml";

function fixture(
  automatic = false,
  mutate = () => {},
  { name = "clsx", manager = "bun" } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "nexa-merge-gate-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  git("remote", "add", "origin", directory);
  mkdirSync(join(directory, ".github"));
  cpSync(policyRoot, join(directory, ".github/dependencies"), {
    recursive: true,
  });
  const policy = JSON.parse(
    readFileSync(join(directory, ".github/dependencies/policy.json")),
  );
  policy.mode = automatic ? "automatic" : "supervised";
  policy.automaticMerging = automatic;
  writeFileSync(
    join(directory, ".github/dependencies/policy.json"),
    JSON.stringify(policy),
  );
  const write = (version) => {
    const manifest = {
      name: "fixture",
      dependencies: { [name]: `^${manager === "bun" ? version : "2.1.0"}` },
      devDependencies: {},
      scripts: { postinstall: "touch MUST_NOT_EXECUTE" },
    };
    const lock = {
      lockfileVersion: 1,
      workspaces: {
        "": {
          name: "fixture",
          dependencies: manifest.dependencies,
          devDependencies: {},
        },
      },
      packages: {
        [name]: [
          `${name}@${manager === "bun" ? version : "2.1.0"}`,
          "",
          {},
          "sha512-YWJj",
        ],
      },
    };
    if (manager === "mise") {
      writeFileSync(
        join(directory, "mise.toml"),
        `[tools]\ngh = "${version}"\n`,
      );
      writeFileSync(
        join(directory, "mise.lock"),
        `[[tools.gh]]\nversion = "${version}"\nbackend = "aqua:cli/cli"\n[tools.gh."platforms.linux-x64"]\nchecksum = "sha256:${"a".repeat(64)}"\nurl = "https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_amd64.tar.gz"\n`,
      );
    }
    if (manager === "github-actions") {
      mkdirSync(join(directory, ".github/workflows"), { recursive: true });
      writeFileSync(
        join(directory, ".github/workflows/ci.yml"),
        `jobs:\n  verify:\n    steps:\n      - uses: actions/checkout@v${version}\n      - run: task verify\n`,
      );
    }
    if (manager === "none")
      writeFileSync(
        join(directory, "README.md"),
        `Application docs ${version}\n`,
      );
    if (version !== "2.1.0") mutate(manifest, lock, directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "bun.lock"), JSON.stringify(lock));
  };
  write("2.1.0");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");
  write("2.1.1");
  git("add", ".");
  git("commit", "--quiet", "-m", "patch");
  const head = git("rev-parse", "HEAD");
  const tested = execFileSync(
    "git",
    ["commit-tree", git("rev-parse", "HEAD^{tree}"), "-p", base, "-p", head],
    { cwd: directory, encoding: "utf8", input: "test merge\n" },
  ).trim();
  const tree = git("rev-parse", "HEAD^{tree}");
  git("checkout", "--quiet", base);
  const identity = {
    repository,
    prNumber: 7,
    headSha: head,
    baseSha: base,
    testedSha: tested,
    runId: 123,
  };
  const pr = {
    number: 7,
    state: "open",
    draft: false,
    merge_commit_sha: tested,
    user: { id: 29139614, login: "renovate[bot]", type: "Bot" },
    head: { sha: head, ref: "renovate/clsx", repo: { full_name: repository } },
    base: { sha: base, ref: "main", repo: { full_name: repository } },
  };
  const key = reviewIdentity(
    identity,
    policy,
    readFileSync(
      join(directory, ".github/dependencies/review-prompt.md"),
      "utf8",
    ),
    readFileSync(
      join(directory, ".github/dependencies/review-schema.json"),
      "utf8",
    ),
    readFileSync(join(directory, ".github/dependencies/codex.toml"), "utf8"),
  );
  const execution = {
    id: 456,
    path: workflow,
    event: "workflow_dispatch",
    head_sha: base,
    head_branch: "main",
    head_repository: { full_name: repository },
    actor: { login: "owner", type: "User" },
  };
  const reviewRun = {
    ...execution,
    id: 222,
    path: ".github/workflows/dependency-review.yml",
    event: "workflow_run",
    display_title: "Dependency review CI 123 PR 7",
    status: "completed",
    conclusion: "success",
  };
  const report = {
    key,
    runId: 222,
    ciRunId: 123,
    identity,
    policy,
    status: "PASS",
    complete: true,
    result: {
      decision: "PASS",
      headSha: head,
      baseSha: base,
      testedSha: tested,
      summary: "Verified exact helper patch",
      findings: [],
      evidence: ["release and usage"],
      uncertainties: [],
    },
  };
  const event = {
    inputs: {
      pr_number: "7",
      approve: "false",
      expected_head: head,
      expected_base: base,
    },
  };
  const env = {
    GITHUB_REPOSITORY: repository,
    GITHUB_EVENT_PATH: join(directory, "event.json"),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "456",
    GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
    AUTOMERGE_ENABLED: automatic ? "true" : "false",
  };
  return {
    directory,
    env,
    event,
    identity,
    commits: {
      [tested]: {
        sha: tested,
        parents: [{ sha: base }, { sha: head }],
        commit: { tree: { sha: tree } },
      },
    },
    pr,
    execution,
    reviewRun,
    report,
    key,
    policy,
    ciRuns: [
      {
        id: 123,
        path: ".github/workflows/ci.yml",
        event: "pull_request",
        head_sha: head,
        head_branch: "renovate/clsx",
        pull_requests: [{ number: 7 }],
        head_repository: { full_name: repository },
        status: "completed",
        conclusion: "success",
      },
    ],
    jobs: ["Validation scope", "Pre-PR validation", "CI validation"].map(
      (name) => ({ name, status: "completed", conclusion: "success" }),
    ),
    approvals: [],
    permission: "admin",
    statuses: [],
    messages: [],
    requests: [],
    headReads: 0,
    race: false,
  };
}

async function withFixture(t, automatic, callback, mutate, options) {
  const f = fixture(automatic, mutate, options);
  t.mock.method(console, "log", (message) => f.messages.push(message));
  const cwd = process.cwd();
  const archive = (filename, value) => {
    writeFileSync(join(f.directory, filename), JSON.stringify(value));
    const zip = join(f.directory, `${filename}.zip`);
    rmSync(zip, { force: true });
    execFileSync("zip", ["-q", zip, filename], { cwd: f.directory });
    return new Response(readFileSync(zip));
  };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = new URL(url).pathname.replace(`/repos/${repository}`, "");
    f.requests.push({ path, method: options.method ?? "GET" });
    let value;
    if (path === "") value = { default_branch: "main" };
    else if (path === "/branches/main")
      value = {
        commit: {
          sha:
            f.baseRace && f.headReads > (f.raceAfter ?? 1)
              ? "d".repeat(40)
              : f.identity.baseSha,
        },
      };
    else if (/^\/pulls\/\d+$/.test(path)) {
      f.headReads++;
      const pr = (f.prs ?? [f.pr]).find(
        (entry) => entry.number === Number(path.slice(7)),
      );
      assert.ok(pr, `Unexpected PR ${path}`);
      value =
        f.race && f.headReads > (f.raceAfter ?? 1)
          ? { ...pr, head: { ...pr.head, sha: "e".repeat(40) } }
          : pr;
    } else if (path.startsWith("/commits/") && f.commits[path.slice(9)])
      value = f.commits[path.slice(9)];
    else if (path === "/pulls") value = f.prs ?? [f.pr];
    else if (path === "/actions/workflows/ci.yml/runs") {
      f.ciReads = (f.ciReads ?? 0) + 1;
      value = {
        workflow_runs:
          f.ciRace && f.ciReads > 1
            ? [
                {
                  ...f.ciRuns[0],
                  id: 124,
                  status: "in_progress",
                  conclusion: null,
                },
              ]
            : f.ciRuns,
      };
    } else if (path === "/actions/workflows/dependency-merge-policy.yml/runs")
      value = { workflow_runs: f.approvals };
    else if (path === "/actions/workflows/dependency-review.yml/runs") {
      f.reviewReads = (f.reviewReads ?? 0) + 1;
      value = {
        workflow_runs:
          f.reviewRace && f.reviewReads > 2
            ? [
                {
                  ...f.reviewRun,
                  id: 223,
                  status: "in_progress",
                  conclusion: null,
                },
                f.reviewRun,
              ]
            : (f.reviewRuns ?? [f.reviewRun]),
      };
    } else if (path === "/actions/runs/333/jobs")
      value = {
        jobs: f.skippedJobs ?? [
          { name: "prepare", status: "completed", conclusion: "skipped" },
        ],
      };
    else if (path === "/actions/runs/123")
      value = f.ciRuns.find((run) => run.id === 123);
    else if (path === "/actions/runs/123/jobs") value = { jobs: f.jobs };
    else if (path === "/actions/runs/456") value = f.execution;
    else if (path.endsWith("/permission")) value = { permission: f.permission };
    else if (path === "/actions/runs/123/artifacts")
      value = {
        artifacts: [
          {
            id: 91,
            name: "validation-identity",
            size_in_bytes: 1000,
            expired: f.expiredIdentity ?? false,
          },
        ],
      };
    else if (path === "/actions/artifacts/91/zip")
      return archive("validation-identity.json", f.identity);
    else if (path === "/actions/runs/222/artifacts")
      value = {
        artifacts: f.reviewArtifacts ?? [
          {
            id: 92,
            name: "dependency-review-input",
            size_in_bytes: 1000,
            expired: false,
          },
          {
            id: 93,
            name: "dependency-review-result",
            size_in_bytes: 1000,
            expired: false,
          },
        ],
      };
    else if (path === "/actions/artifacts/92/zip")
      return f.corruptInput
        ? new Response("invalid zip")
        : archive(
            "report.json",
            f.input ?? {
              runId: 222,
              key: f.key,
              identity: f.identity,
              status: "PENDING",
            },
          );
    else if (path === "/actions/artifacts/93/zip")
      return f.corruptResult
        ? new Response("invalid zip")
        : archive("report.json", f.report);
    else if (path === "/actions/runs/444/artifacts")
      value = {
        artifacts: [
          {
            id: 94,
            name: "dependency-human-approval",
            size_in_bytes: 1000,
            expired: false,
          },
        ],
      };
    else if (path === "/actions/artifacts/94/zip")
      return archive("approval.json", f.approval);
    else if (/^\/statuses\/[a-f0-9]{40}$/.test(path)) {
      f.statuses.push(JSON.parse(options.body));
      value = {};
    } else throw new Error(`Unexpected request ${path}`);
    return new Response(JSON.stringify(value));
  });
  process.chdir(f.directory);
  const run = async () => {
    f.headReads = 0;
    f.ciReads = 0;
    f.reviewReads = 0;
    writeFileSync(f.env.GITHUB_EVENT_PATH, JSON.stringify(f.event));
    f.decisions = await gate(join(f.directory, "approval"), f.env);
    return f.statuses.at(-1);
  };
  try {
    await callback(f, run);
  } finally {
    process.chdir(cwd);
    rmSync(f.directory, { recursive: true, force: true });
  }
}

function runCLI(f) {
  const preload = join(f.directory, "mock-github.mjs");
  const statuses = join(f.directory, "cli-statuses.json");
  writeFileSync(
    join(f.directory, "cli-data.json"),
    JSON.stringify({
      repository,
      prs: f.prs ?? [f.pr],
      base: f.identity.baseSha,
      ciRuns: f.ciRuns,
    }),
  );
  writeFileSync(
    preload,
    `import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("cli-data.json", "utf8"));
const statuses = [];
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname.replace("/repos/" + data.repository, "");
  let value;
  if (path === "") value = {default_branch: "main"};
  else if (path === "/branches/main") value = {commit: {sha: data.base}};
  else if (path === "/pulls") value = data.prs;
  else if (/^\\/pulls\\/\\d+$/.test(path))
    value = data.prs.find(pr => pr.number === Number(path.slice(7)));
  else if (path === "/actions/workflows/ci.yml/runs")
    value = {workflow_runs: data.ciRuns};
  else if (path.startsWith("/statuses/")) {
    statuses.push({sha: path.slice(10), ...JSON.parse(options.body)});
    writeFileSync("cli-statuses.json", JSON.stringify(statuses));
    value = {};
  } else throw new Error("Unexpected network request " + url);
  return new Response(JSON.stringify(value));
};
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      preload,
      fileURLToPath(new URL("./merge-policy.mjs", import.meta.url)),
      join(f.directory, "cli-approval"),
    ],
    {
      cwd: f.directory,
      env: { ...process.env, ...f.env, GH_TOKEN: "fixture-token" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(result.error, undefined);
  return {
    ...result,
    statuses: JSON.parse(readFileSync(statuses, "utf8")),
  };
}

test("automatic mode requires independently verified dependency changes, current CI and trusted PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    const status = await run();
    assert.equal(status.state, "success");
    assert.match(
      status.description,
      /Eligible dependency minor\/patch or pin update/,
    );
    assert.equal(status.context, "Dependency merge policy");
    assert.equal(existsSync(join(f.directory, "MUST_NOT_EXECUTE")), false);
    assert.ok(
      f.requests
        .filter((entry) => entry.method !== "GET")
        .every((entry) => entry.path.startsWith("/statuses/")),
    );
  }));

test("dependency minor updates still require current complete trusted PASS and successful CI", async (t) =>
  withFixture(
    t,
    true,
    async (f, run) => {
      assert.equal((await run()).state, "success");
      const valid = structuredClone(f.report);
      for (const change of [
        { status: "BLOCK" },
        { status: "ERROR" },
        { complete: false },
        { key: "old-policy-review" },
        { identity: { ...valid.identity, headSha: "f".repeat(40) } },
      ]) {
        f.report = { ...valid, ...change };
        assert.equal((await run()).state, "failure");
      }
      f.report = valid;
      f.ciRuns[0].conclusion = "failure";
      assert.equal((await run()).state, "failure");
    },
    (manifest, lock) => {
      manifest.dependencies.clsx = "^2.2.0";
      lock.packages.clsx[0] = "clsx@2.2.0";
    },
  ));

test("the runtime kill switch blocks an activated policy without human approval", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.env.AUTOMERGE_ENABLED = "false";
    assert.equal((await run()).state, "failure");
  }));

test("expired CI identity artifacts never qualify", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.expiredIdentity = true;
    const status = await run();
    assert.equal(status.state, "failure");
    assert.match(status.description, /artifact/);
  }));

test("supervised/default mode and the independent kill switch cannot use an AI PASS", async (t) =>
  withFixture(t, false, async (f, run) => {
    assert.equal((await run()).state, "failure");
    f.env.AUTOMERGE_ENABLED = "true";
    assert.equal((await run()).state, "failure");
  }));

test("missing current CI stays pending without approving automatic or human completion", async (t) => {
  for (const automatic of [false, true]) {
    await withFixture(t, automatic, async (f, run) => {
      f.event.inputs.approve = automatic ? "false" : "true";
      const oldRun = { ...f.ciRuns[0], head_sha: "e".repeat(40) };
      for (const candidates of [[], [oldRun]]) {
        f.ciRuns = candidates;
        const status = await run();
        assert.equal(status.state, "pending");
        assert.match(
          status.description,
          /Waiting for current-revision CI to start/,
        );
        assert.equal(
          existsSync(join(f.directory, "approval/approval.json")),
          false,
        );
      }
      assert.ok(f.statuses.every((status) => status.state === "pending"));
      assert.ok(
        !f.requests.some((request) => request.path.endsWith("/artifacts")),
      );
    });
  }
});

test("newer active CI stays pending on both revisions despite an older successful run", async (t) =>
  withFixture(t, true, async (f, run) => {
    for (const state of [
      "requested",
      "queued",
      "pending",
      "waiting",
      "in_progress",
    ]) {
      f.ciRuns.unshift({
        ...f.ciRuns[0],
        id: 124,
        status: state,
        conclusion: null,
      });
      const status = await run();
      assert.equal(status.state, "pending");
      assert.equal(
        status.description,
        `Waiting for current-revision CI to finish (${state})`,
      );
      assert.ok(
        f.statuses
          .slice(-2)
          .every(
            (entry) =>
              entry.state === "pending" &&
              entry.context === "Dependency merge policy",
          ),
      );
      assert.deepEqual(
        f.requests
          .filter((request) => request.method === "POST")
          .slice(-2)
          .map((request) => request.path),
        [`/statuses/${f.pr.head.sha}`, `/statuses/${f.pr.merge_commit_sha}`],
      );
      f.ciRuns.shift();
    }
    assert.ok(
      !f.requests.some((request) => request.path.endsWith("/artifacts")),
    );
    assert.match(
      readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8"),
      /\*\*pending\*\* — Waiting for current-revision CI/,
    );
    assert.equal((await run()).state, "success");
  }));

test("a failed CI rerun returns to pending and only succeeds after completion", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.ciRuns[0].conclusion = "failure";
    assert.equal((await run()).state, "failure");
    f.ciRuns[0].status = "in_progress";
    f.ciRuns[0].conclusion = null;
    assert.equal((await run()).state, "pending");
    f.ciRuns[0].status = "completed";
    f.ciRuns[0].conclusion = "failure";
    assert.equal((await run()).state, "failure");
    f.ciRuns[0].conclusion = "success";
    assert.equal((await run()).state, "success");
  }));

test("unexpected CI workflow paths or statuses still fail", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.ciRuns[0].status = "in_progress";
    f.ciRuns[0].path = ".github/workflows/spoof.yml";
    assert.equal((await run()).state, "failure");
    f.ciRuns[0].path = ".github/workflows/ci.yml";
    f.ciRuns[0].status = "unknown";
    assert.equal((await run()).state, "failure");
  }));

test("latest unsuccessful or incomplete completed CI blocks without falling back", async (t) =>
  withFixture(t, true, async (f, run) => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
      "neutral",
      "stale",
      null,
    ]) {
      f.ciRuns.unshift({ ...f.ciRuns[0], id: 124, conclusion });
      assert.equal((await run()).state, "failure");
      f.ciRuns.shift();
    }
    for (const conclusion of ["failure", "cancelled", "skipped"]) {
      f.jobs[2].conclusion = conclusion;
      assert.equal((await run()).state, "failure");
    }
    f.jobs = [];
    assert.equal((await run()).state, "failure");
  }));

test("AI failures, incomplete evidence, schema errors, and stale review identities never authorize", async (t) =>
  withFixture(t, true, async (f, run) => {
    const valid = structuredClone(f.report);
    for (const status of [
      "ERROR",
      "BLOCK",
      "NEEDS_HUMAN",
      "PENDING",
      "DISABLED",
    ]) {
      f.report = { ...valid, status };
      assert.equal((await run()).state, "failure");
    }
    for (const change of [
      { complete: false },
      { key: "stale" },
      { runId: 999 },
      { result: {} },
      { identity: { ...valid.identity, headSha: "f".repeat(40) } },
      { result: { ...valid.result, uncertainties: ["missing usage"] } },
      { result: { ...valid.result, decision: "NEEDS_HUMAN" } },
    ]) {
      f.report = { ...valid, ...change };
      assert.equal((await run()).state, "failure");
    }
  }));

test("untrusted workflow provenance and a new failed review cannot reuse an older PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    for (const change of [
      { event: "pull_request" },
      { path: ".github/workflows/spoof.yml" },
      { head_repository: { full_name: "attacker/fork" } },
      { status: "in_progress", conclusion: null },
      { conclusion: "failure" },
      { head_sha: "f".repeat(40) },
    ]) {
      const old = f.reviewRun;
      f.reviewRun = { ...old, ...change };
      f.reviewRuns = [f.reviewRun, { ...old, id: 221 }];
      assert.equal(
        (await run()).state,
        change.status === "in_progress" ? "pending" : "failure",
      );
      f.reviewRun = old;
      f.reviewRuns = undefined;
    }
  }));

test("authorized human completion supports forks while automatic approval rejects them", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.pr.head.repo.full_name = "contributor/fork";
    f.ciRuns[0].head_repository.full_name = "contributor/fork";
    assert.equal((await run()).state, "failure");
    f.event.inputs.approve = "true";
    f.pr.user = { type: "User", login: "contributor" };
    assert.equal((await run()).state, "success");
  }));

test("unrelated source files cannot qualify even with an AI PASS", async (t) =>
  withFixture(
    t,
    true,
    async (_f, run) => {
      assert.equal((await run()).state, "failure");
    },
    (_manifest, _lock, directory) => {
      writeFileSync(
        join(directory, "unrelated.mjs"),
        "throw new Error('must never execute');\n",
      );
    },
  ));

test("transitive changes can qualify with current complete trusted AI PASS", async (t) =>
  withFixture(
    t,
    true,
    async (_f, run) => {
      assert.equal((await run()).state, "success");
    },
    (_manifest, lock) => {
      lock.packages.transitive = ["transitive@1.0.1", "", {}, "sha512-YWJj"];
    },
  ));

test("changed revisions and publication races never publish obsolete decisions", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.race = true;
    await run();
    assert.equal(f.decisions[0].state, "obsolete");
    assert.equal(f.statuses.length, 0);
  }));

test("human approval preserves CI, verifies actor permissions and binds exact revisions", async (t) =>
  withFixture(t, false, async (f, run) => {
    f.event.inputs.approve = "true";
    f.pr.user = { type: "User", login: "owner" };
    assert.equal((await run()).state, "success");
    const approval = JSON.parse(
      readFileSync(join(f.directory, "approval/approval.json")),
    );
    assert.equal(approval.headSha, f.identity.headSha);
    assert.equal(approval.baseSha, f.identity.baseSha);
    assert.equal(approval.actor, "owner");
    for (const permission of ["read", "triage", "none"]) {
      f.permission = permission;
      assert.equal((await run()).state, "failure");
    }
    f.permission = "admin";
    f.execution.actor.type = "Bot";
    assert.equal((await run()).state, "failure");
    f.execution.actor.type = "User";
    f.event.inputs.expected_head = "f".repeat(40);
    assert.equal((await run()).state, "failure");
    f.event.inputs.expected_head = f.identity.headSha;
    f.ciRuns[0].conclusion = "failure";
    assert.equal((await run()).state, "failure");
  }));

test("regenerated merge commits reuse CI only for identical parents and complete trees", async (t) => {
  for (const automatic of [false, true]) {
    await withFixture(t, automatic, async (f, run) => {
      if (!automatic) f.event.inputs.approve = "true";
      const regenerated = "f".repeat(40);
      const tested = f.commits[f.identity.testedSha];
      f.pr.merge_commit_sha = regenerated;
      f.commits[regenerated] = { ...structuredClone(tested), sha: regenerated };
      assert.equal((await run()).state, "success");
      // Keep the original tested identity for AI and human approval provenance.
      if (!automatic) {
        const approval = JSON.parse(
          readFileSync(join(f.directory, "approval/approval.json")),
        );
        assert.equal(approval.key, f.key);
      }
      for (const change of [
        { commit: { tree: { sha: "e".repeat(40) } } },
        { commit: {} },
        { parents: [{ sha: f.identity.baseSha }] },
        {
          parents: [{ sha: "e".repeat(40) }, { sha: f.identity.headSha }],
        },
        {
          parents: [{ sha: f.identity.baseSha }, { sha: "e".repeat(40) }],
        },
      ]) {
        f.commits[regenerated] = {
          ...structuredClone(tested),
          sha: regenerated,
          ...change,
        };
        assert.equal((await run()).state, "failure");
      }
      f.commits[regenerated] = { ...structuredClone(tested), sha: regenerated };
      delete tested.commit;
      assert.equal((await run()).state, "failure");
    });
  }
});

test("a persisted human attestation is usable only from the trusted current default-branch run", async (t) =>
  withFixture(t, false, async (f, run) => {
    f.approvals = [
      { ...f.execution, id: 444, status: "completed", conclusion: "success" },
    ];
    f.approval = {
      runId: 444,
      key: f.key,
      repository,
      prNumber: 7,
      headSha: f.identity.headSha,
      baseSha: f.identity.baseSha,
      actor: "owner",
    };
    assert.equal((await run()).state, "success");
    for (const change of [
      { headSha: "f".repeat(40) },
      { baseSha: "f".repeat(40) },
      { actor: "attacker" },
      { key: "stale" },
      { repository: "attacker/fork" },
    ]) {
      const original = f.approval;
      f.approval = { ...original, ...change };
      assert.equal((await run()).state, "failure");
      f.approval = original;
    }
    f.approvals[0].event = "pull_request";
    assert.equal((await run()).state, "failure");
  }));

test("labels and AI PASS cannot qualify added dependencies in grouped updates", async (t) =>
  withFixture(
    t,
    true,
    async (f, run) => {
      f.pr.labels = [{ name: "automerge" }];
      assert.equal((await run()).state, "failure");
    },
    (manifest, lock) => {
      manifest.dependencies.next = "^16.3.9";
      lock.workspaces[""].dependencies = manifest.dependencies;
      lock.packages.next = ["next@16.3.9", "", {}, "sha512-YWJj"];
    },
  ));

test("an AI PASS cannot authorize an impersonated Renovate author", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.pr.user.id = 1;
    assert.equal((await run()).state, "failure");
  }));

test("report validation and human authorization reject malformed identities", async () => {
  assert.equal(
    await authorizedHuman(
      {
        api: () => {
          throw new Error("must not fetch");
        },
      },
      { type: "Bot", login: "owner" },
    ),
    false,
  );
  assert.equal(
    trustedRun(
      {
        path: workflow,
        event: "pull_request",
        status: "completed",
        conclusion: "success",
      },
      workflow,
      repository,
      "a".repeat(40),
      "main",
    ),
    false,
  );
  assert.throws(
    () => assertReport({}, { id: 1 }, {}, { maxResultBytes: 8192 }, "key", {}),
    /PASS/,
  );
});

for (const options of [
  { name: "zod" },
  { manager: "mise" },
  { manager: "github-actions" },
])
  test(`${options.name ?? options.manager} automatic approval requires fresh trusted CI and Sol PASS`, async (t) =>
    withFixture(
      t,
      true,
      async (f, run) => {
        assert.equal((await run()).state, "success");
        for (const status of ["BLOCK", "NEEDS_HUMAN", "ERROR"]) {
          f.report.status = status;
          assert.equal((await run()).state, "failure");
        }
        f.report.status = "PASS";
        f.ciRuns[0].conclusion = "cancelled";
        assert.equal((await run()).state, "failure");
      },
      undefined,
      options,
    ));

test("ordinary PRs resolve both statuses without CI evidence, AI, or human attestation", async (t) => {
  for (const automatic of [false, true])
    await withFixture(
      t,
      automatic,
      async (f, run) => {
        f.pr.user = { type: "User", login: "owner" };
        f.pr.head.ref = "feature/docs";
        f.ciRuns = [];
        f.event.inputs.approve = "true";
        // Classification must not even open policy/review files on the N/A path.
        rmSync(join(f.directory, ".github/dependencies"), { recursive: true });
        const result = await run();
        assert.equal(result.state, "success");
        assert.match(
          result.description,
          /^Not applicable: no dependency changes/,
        );
        assert.ok(
          f.statuses.slice(-2).every((entry) => entry.state === "success"),
        );
        assert.deepEqual(
          f.requests
            .filter(({ method }) => method === "POST")
            .slice(-2)
            .map(({ path }) => path),
          [`/statuses/${f.pr.head.sha}`, `/statuses/${f.pr.merge_commit_sha}`],
        );
        assert.ok(
          !f.requests.some(
            ({ path }) =>
              path.startsWith("/actions/") || path.endsWith("/permission"),
          ),
        );
        assert.equal(
          existsSync(join(f.directory, "approval/approval.json")),
          false,
        );
        assert.equal(existsSync(join(f.directory, "MUST_NOT_EXECUTE")), false);
      },
      () => {},
      { manager: "none" },
    );
});

test("ordinary PR publication still rejects revision races", async (t) =>
  withFixture(
    t,
    false,
    async (f, run) => {
      f.race = true;
      await run();
      assert.equal(f.decisions[0].state, "obsolete");
      assert.equal(f.statuses.length, 0);
    },
    () => {},
    { manager: "none" },
  ));

test("unreadable diff evidence fails without attempting dependency review", async (t) =>
  withFixture(
    t,
    false,
    async (f, run) => {
      f.pr.head.sha = "f".repeat(40);
      assert.equal((await run()).state, "failure");
      assert.ok(!f.requests.some(({ path }) => path.startsWith("/actions/")));
    },
    () => {},
    { manager: "none" },
  ));

test("human updates remain applicable for every supported manager", async (t) => {
  for (const automatic of [false, true])
    for (const manager of ["bun", "mise", "github-actions"])
      await withFixture(
        t,
        automatic,
        async (f, run) => {
          f.pr.user = { type: "User", login: "owner" };
          f.pr.head.ref = "feature/dependency";
          const result = await run();
          assert.equal(result.state, "failure");
          assert.match(result.description, /explicit human review approval/);
          assert.ok(
            !f.requests.some(({ path }) =>
              path.includes("dependency-review.yml"),
            ),
          );
          f.event.inputs.approve = "true";
          assert.equal((await run()).state, "success");
        },
        () => {},
        { manager },
      );
});

test("policy decisions are visible in logs, annotations and actionable summaries", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.pr.user = { type: "User", login: "owner" };
    const result = await run();
    assert.equal(result.state, "failure");
    assert.deepEqual(f.decisions, [
      {
        prNumber: f.pr.number,
        state: "failure",
        reason:
          "Requires explicit human review approval; automatic review unavailable: Only open, same-repository Renovate PRs can enter the reviewer.",
      },
    ]);
    assert.match(f.messages[0], /PR #7: failure — Requires explicit human/);
    assert.match(f.messages[1], /^::error::PR #7: failure/);
    const summary = readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8");
    for (const text of [
      "personally reviewing this exact revision",
      "approve=true",
      `expected_head=${f.pr.head.sha}`,
      `expected_base=${f.pr.base.sha}`,
      `https://github.com/${repository}/actions/workflows/dependency-merge-policy.yml`,
    ])
      assert.ok(summary.includes(text), text);

    f.messages.length = 0;
    f.ciRuns[0].status = "in_progress";
    f.ciRuns[0].conclusion = null;
    assert.equal((await run()).state, "pending");
    assert.equal(f.decisions[0].state, "pending");
    assert.match(f.messages[1], /^::notice::PR #7: pending/);
    assert.ok(!f.messages.some((message) => message.startsWith("::error::")));
    assert.match(
      readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8"),
      /required Dependency merge policy status remains pending/,
    );

    f.messages.length = 0;
    f.ciRuns[0].status = "completed";
    f.ciRuns[0].conclusion = "success";
    f.event.inputs.approve = "true";
    assert.equal((await run()).state, "success");
    assert.equal(f.decisions[0].state, "success");
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0], /PR #7: success — Human approval/);
  }));

test("a failed decision does not stop publication for the other open PRs", async (t) =>
  withFixture(
    t,
    true,
    async (f, run) => {
      f.env.GITHUB_EVENT_NAME = "push";
      f.prs = [
        { ...f.pr, draft: true },
        { ...f.pr, number: 8 },
      ];
      assert.equal((await run()).state, "success");
      assert.deepEqual(
        f.decisions.map(({ prNumber, state }) => ({ prNumber, state })),
        [
          { prNumber: 7, state: "failure" },
          { prNumber: 8, state: "success" },
        ],
      );
      assert.match(f.messages[1], /^::error::PR #7: failure/);
      assert.match(f.messages[2], /PR #8: success — Not applicable/);
      const cli = runCLI(f);
      assert.equal(cli.status, 1, cli.stderr);
      assert.match(cli.stdout, /::error::PR #7: failure/);
      assert.match(cli.stdout, /PR #8: success — Not applicable/);
      assert.deepEqual(
        cli.statuses.map(({ state }) => state),
        [
          "pending",
          "pending",
          "failure",
          "failure",
          "pending",
          "pending",
          "success",
          "success",
        ],
      );
    },
    () => {},
    { manager: "none" },
  ));

test("the actual CLI exits successfully for pending and non-applicable decisions", async (t) => {
  for (const state of ["pending", "success"])
    await withFixture(
      t,
      true,
      async (f) => {
        f.ciRuns = [];
        writeFileSync(f.env.GITHUB_EVENT_PATH, JSON.stringify(f.event));
        const cli = runCLI(f);
        assert.equal(cli.status, 0, cli.stderr);
        assert.match(cli.stdout, new RegExp(`PR #7: ${state}`));
        assert.equal(cli.statuses.at(-1).state, state);
        assert.doesNotMatch(cli.stdout, /::error::/);
        if (state === "pending") assert.match(cli.stdout, /::notice::/);
      },
      () => {},
      { manager: state === "pending" ? "bun" : "none" },
    );
});

test("a major dependency update stays applicable and requires human review", async (t) =>
  withFixture(
    t,
    true,
    async (_f, run) => {
      const result = await run();
      assert.equal(result.state, "failure");
      assert.doesNotMatch(result.description, /Not applicable/);
    },
    (manifest, lock) => {
      manifest.dependencies.clsx = "^3.0.0";
      lock.workspaces[""].dependencies.clsx = "^3.0.0";
      lock.packages.clsx[0] = "clsx@3.0.0";
    },
  ));

test("trusted evidence requires the renamed CI aggregate, not just its legacy alias", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.jobs[2].name = "Dependency validation";
    const result = await run();
    assert.equal(result.state, "failure");
    assert.match(
      result.description,
      /Required CI job missing or failed: CI validation/,
    );
  }));

test("conservative YAML applicability preserves explicit human completion", async (t) =>
  withFixture(
    t,
    false,
    async (f, run) => {
      const result = await run();
      assert.equal(result.state, "failure");
      assert.match(result.description, /explicit human review approval/);
      f.event.inputs.approve = "true";
      assert.equal((await run()).state, "success");
    },
    (_manifest, _lock, directory) => {
      mkdirSync(join(directory, ".github/workflows"), { recursive: true });
      writeFileSync(
        join(directory, ".github/workflows/flow.yml"),
        "jobs: {test: {steps: [{uses: actions/checkout@v7}]}}\n",
      );
    },
    { manager: "none" },
  ));

test("unrelated artifact-less skipped and failed reviews cannot poison a matching PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    const legacy = {
      ...f.reviewRun,
      id: 333,
      display_title: "Dependency review",
      conclusion: "skipped",
    };
    const unrelated = {
      ...f.reviewRun,
      id: 334,
      event: "workflow_dispatch",
      display_title: "Dependency review PR 8",
      conclusion: "failure",
    };
    f.reviewRuns = [unrelated, legacy, f.reviewRun];
    assert.equal((await run()).state, "success");
    assert.ok(
      !f.requests.some(({ path }) => /runs\/(333|334)\/artifacts/.test(path)),
    );
  }));

test("missing, expired, ambiguous and corrupt matching input evidence block older PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.reviewRuns = [f.reviewRun, { ...f.reviewRun, id: 221 }];
    const valid = [
      {
        id: 92,
        name: "dependency-review-input",
        size_in_bytes: 1000,
        expired: false,
      },
      {
        id: 93,
        name: "dependency-review-result",
        size_in_bytes: 1000,
        expired: false,
      },
    ];
    for (const artifacts of [
      [],
      [{ ...valid[0], expired: true }],
      [valid[0], { ...valid[0], id: 94 }],
      [{ ...valid[0], size_in_bytes: 65537 }],
      [valid[0]],
      [valid[0], { ...valid[1], expired: true }],
      [valid[0], valid[1], { ...valid[1], id: 95 }],
    ]) {
      f.reviewArtifacts = artifacts;
      assert.equal((await run()).state, "failure");
      assert.ok(
        !f.requests.some(({ path }) => path === "/actions/runs/221/artifacts"),
      );
    }
    f.reviewArtifacts = valid;
    f.corruptInput = true;
    assert.equal((await run()).state, "failure");
    f.corruptInput = false;
    f.corruptResult = true;
    assert.equal((await run()).state, "failure");
    f.corruptResult = false;
    f.input = {
      runId: 222,
      key: f.key,
      identity: { ...f.identity, testedSha: "bad" },
      status: "PENDING",
    };
    assert.equal((await run()).state, "failure");
  }));

test("matching active review transitions to PASS or completed failure without fallback", async (t) =>
  withFixture(t, true, async (f, run) => {
    const original = structuredClone(f.reviewRun);
    f.reviewRuns = [f.reviewRun, { ...original, id: 221 }];
    for (const status of ["requested", "queued", "waiting", "in_progress"]) {
      f.reviewRun.status = status;
      f.reviewRun.conclusion = null;
      assert.equal((await run()).state, "pending");
    }
    f.reviewRun.status = "completed";
    f.reviewRun.conclusion = "failure";
    assert.equal((await run()).state, "failure");
    f.reviewRun.conclusion = "success";
    assert.equal((await run()).state, "success");
    for (const status of ["DISABLED", "NEEDS_HUMAN", "ERROR", "BLOCK"]) {
      f.input = {
        runId: 222,
        key: f.key,
        identity: f.identity,
        status,
        reason: "Fix bounded evidence/setup then rerun",
      };
      const result = await run();
      assert.equal(result.state, "failure");
      assert.match(result.description, new RegExp(status));
    }
  }));

test("rerun attempt cannot reuse previous-attempt artifacts", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.reviewRun.run_attempt = 2;
    assert.equal((await run()).state, "failure");
    f.input = {
      runId: 222,
      runAttempt: 2,
      key: f.key,
      identity: f.identity,
      status: "PENDING",
    };
    assert.equal((await run()).state, "failure");
    f.report.runAttempt = 2;
    assert.equal((await run()).state, "success");
  }));

test("old revision and old policy evidence never supplies a current PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.input = {
      runId: 222,
      key: f.key,
      identity: { ...f.identity, headSha: "f".repeat(40) },
      status: "PENDING",
    };
    assert.equal((await run()).state, "failure");
    f.input.identity = f.identity;
    f.input.key = "old-policy";
    assert.equal((await run()).state, "failure");
    assert.match(f.statuses.at(-1).description, /policy changed/);
  }));

test("base/head races before final publication cannot overwrite a newer decision", async (t) => {
  for (const state of ["success", "failure", "pending"]) {
    for (const baseRace of [false, true]) {
      await withFixture(t, true, async (f, run) => {
        f.raceAfter = state === "success" ? 4 : 3;
        f.baseRace = baseRace;
        f.race = !baseRace;
        if (state === "failure") f.ciRuns[0].conclusion = "failure";
        if (state === "pending") f.ciRuns[0].status = "in_progress";
        await run();
        assert.equal(f.decisions[0].state, "obsolete");
        assert.deepEqual(
          f.statuses.map(({ state }) => state),
          ["pending", "pending"],
        );
      });
    }
  }
});

test("freshness is checked between head and merge status writes", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.race = true;
    f.raceAfter = 2;
    await run();
    assert.equal(f.decisions[0].state, "obsolete");
    assert.deepEqual(
      f.statuses.map(({ state }) => state),
      ["pending"],
    );
  }));

test("CI and review reruns supersede decisions even when head/base remain unchanged", async (t) => {
  for (const initial of ["success", "failure", "pending"]) {
    await withFixture(t, true, async (f, run) => {
      if (initial === "failure") f.ciRuns[0].conclusion = "failure";
      if (initial === "pending") f.ciRuns[0].status = "queued";
      f.ciRace = true;
      await run();
      assert.equal(f.decisions[0].state, "obsolete");
      assert.deepEqual(
        f.statuses.map(({ state }) => state),
        ["pending", "pending"],
      );
    });
  }
  await withFixture(t, true, async (f, run) => {
    f.reviewRace = true;
    await run();
    assert.equal(f.decisions[0].state, "obsolete");
    assert.deepEqual(
      f.statuses.map(({ state }) => state),
      ["pending", "pending"],
    );
  });
});

test("read-only matrix planning resolves targets without publishing or loading approval evidence", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.env.PLAN_ONLY = "true";
    f.env.GITHUB_OUTPUT = join(f.directory, "targets.txt");
    await run();
    assert.equal(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), "prs=[7]\n");
    assert.deepEqual(f.statuses, []);
    assert.deepEqual(f.decisions, []);
    assert.ok(!f.requests.some(({ path }) => path.includes("artifacts")));
  }));

test("queued legacy Actions workflow cannot publish outside the new per-PR lock", async (t) =>
  withFixture(t, true, async (f, run) => {
    f.env.GITHUB_ACTIONS = "true";
    await assert.rejects(run(), /lacks the per-PR publication lock/);
    assert.deepEqual(f.statuses, []);
    f.env.TARGET_PR = "7";
    assert.equal((await run()).state, "success");
  }));
