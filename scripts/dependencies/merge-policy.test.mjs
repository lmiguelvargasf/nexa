import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function fixture(automatic = false, mutate = () => {}) {
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
      dependencies: { clsx: `^${version}` },
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
      packages: { clsx: [`clsx@${version}`, "", {}, "sha512-YWJj"] },
    };
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
        head_repository: { full_name: repository },
        status: "completed",
        conclusion: "success",
      },
    ],
    jobs: [
      "Validation scope",
      "Pre-PR validation",
      "Dependency validation",
    ].map((name) => ({ name, status: "completed", conclusion: "success" })),
    approvals: [],
    permission: "admin",
    statuses: [],
    requests: [],
    headReads: 0,
    race: false,
  };
}

async function withFixture(t, automatic, callback, mutate) {
  const f = fixture(automatic, mutate);
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
      value = { commit: { sha: f.identity.baseSha } };
    else if (path === "/pulls/7") {
      f.headReads++;
      value =
        f.race && f.headReads > 1
          ? { ...f.pr, head: { ...f.pr.head, sha: "e".repeat(40) } }
          : f.pr;
    } else if (path.startsWith("/commits/") && f.commits[path.slice(9)])
      value = f.commits[path.slice(9)];
    else if (path === "/actions/workflows/ci.yml/runs")
      value = { workflow_runs: f.ciRuns };
    else if (path === "/actions/workflows/dependency-merge-policy.yml/runs")
      value = { workflow_runs: f.approvals };
    else if (path === "/actions/workflows/dependency-review.yml/runs")
      value = { workflow_runs: f.reviewRuns ?? [f.reviewRun] };
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
        artifacts: [
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
      return archive("report.json", {
        identity: f.identity,
        status: "PENDING",
      });
    else if (path === "/actions/artifacts/93/zip")
      return archive("report.json", f.report);
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
    writeFileSync(f.env.GITHUB_EVENT_PATH, JSON.stringify(f.event));
    await gate(join(f.directory, "approval"), f.env);
    return f.statuses.at(-1);
  };
  try {
    await callback(f, run);
  } finally {
    process.chdir(cwd);
    rmSync(f.directory, { recursive: true, force: true });
  }
}

test("automatic mode requires independently verified helper changes, current CI and trusted PASS", async (t) =>
  withFixture(t, true, async (f, run) => {
    const status = await run();
    assert.equal(status.state, "success");
    assert.match(status.description, /Eligible helper patch/);
    assert.equal(status.context, "Dependency merge policy");
    assert.equal(existsSync(join(f.directory, "MUST_NOT_EXECUTE")), false);
    assert.ok(
      f.requests
        .filter((entry) => entry.method !== "GET")
        .every((entry) => entry.path.startsWith("/statuses/")),
    );
  }));

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

test("latest failed, missing, cancelled and skipped-required CI blocks without falling back", async (t) =>
  withFixture(t, true, async (f, run) => {
    for (const conclusion of ["failure", "cancelled", "skipped", null]) {
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
      assert.equal((await run()).state, "failure");
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

test("transitive changes cannot qualify even with an AI PASS", async (t) =>
  withFixture(
    t,
    true,
    async (_f, run) => {
      assert.equal((await run()).state, "failure");
    },
    (_manifest, lock) => {
      lock.packages.transitive = ["transitive@1.0.1", "", {}, "sha512-YWJj"];
    },
  ));

test("a changed head, base, tested merge or publication race invalidates approval", async (t) =>
  withFixture(t, true, async (f, run) => {
    for (const key of ["head", "base"]) {
      const sha = f.pr[key].sha;
      f.pr[key].sha = "f".repeat(40);
      assert.equal((await run()).state, "failure");
      f.pr[key].sha = sha;
    }
    f.pr.merge_commit_sha = "f".repeat(40);
    assert.equal((await run()).state, "failure");
    f.pr.merge_commit_sha = f.identity.testedSha;
    f.race = true;
    assert.equal((await run()).state, "failure");
    assert.match(f.statuses.at(-1).description, /changed during evaluation/);
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

test("labels and AI PASS cannot qualify protected or transitive grouped updates", async (t) =>
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
