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
import { prepare, publish } from "./review.mjs";

const trusted = new URL("../../.github/dependencies/", import.meta.url);
function fixture({
  sameResolution = false,
  transitive = false,
  tooManyTests = false,
  manager = "bun",
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nexa-dependency-integration-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  git("remote", "add", "origin", directory);
  mkdirSync(join(directory, ".github"));
  cpSync(trusted, join(directory, ".github/dependencies"), { recursive: true });
  mkdirSync(join(directory, "src"));
  writeFileSync(
    join(directory, "src/usage.ts"),
    "import { clsx } from 'clsx';\nexport const classes = clsx('px-2');\n",
  );
  for (const suffix of tooManyTests
    ? [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]
    : [".test.ts"])
    writeFileSync(
      join(directory, `src/usage${suffix}`),
      "import { classes } from './usage';\nthrow new Error('TEST_MUST_NOT_EXECUTE');\n",
    );
  if (tooManyTests)
    writeFileSync(
      join(directory, "src/another.ts"),
      "import { clsx } from 'clsx';\n",
    );
  mkdirSync(join(directory, ".github/workflows"));
  mkdirSync(join(directory, "scripts/skills"), { recursive: true });
  writeFileSync(
    join(directory, "prek.toml"),
    'minimum_prek_version = "2.1.0"\n',
  );
  writeFileSync(join(directory, "scripts/setup.sh"), "task hooks:install\n");
  writeFileSync(
    join(directory, "scripts/skills/update.mjs"),
    'throw new Error("TOOL_CONSUMER_MUST_NOT_RUN");\n',
  );
  writeFileSync(
    join(directory, ".github/workflows/ci.yml"),
    "name: CI\non: pull_request\njobs:\n  verify:\n    steps:\n      - run: task verify:all\n",
  );
  const packageAt = (version) => ({
    name: "fixture",
    dependencies: { clsx: `^${version}` },
    devDependencies: {},
    scripts: { postinstall: "touch INSTALL_HOOK_MUST_NOT_RUN" },
  });
  const write = (version) => {
    const manifest = packageAt(manager === "bun" ? version : "2.1.0");
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      join(directory, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "fixture",
            dependencies: manifest.dependencies,
            devDependencies: {},
          },
        },
        packages: {
          clsx: [
            `clsx@${manager !== "bun" ? "2.1.0" : sameResolution ? "2.1.1" : version}`,
            "",
            {},
            "sha512-YWJj",
          ],
          ...(transitive
            ? {
                indirect: [
                  `indirect@${version === "2.1.0" ? "1.0.0" : "1.0.1"}`,
                  "",
                  {},
                  "sha512-YWJj",
                ],
              }
            : {}),
        },
      }),
    );
  };
  const writeDependency = (version) => {
    write(version);
    if (manager === "mise") {
      writeFileSync(
        join(directory, "mise.toml"),
        `[tools]\nprek = "${version}"\n`,
      );
      writeFileSync(
        join(directory, "mise.lock"),
        `[[tools.prek]]\nversion = "${version}"\nbackend = "aqua:j178/prek"\n[tools.prek."platforms.linux-x64"]\nchecksum = "sha256:${"a".repeat(64)}"\nurl = "https://github.com/j178/prek/releases/download/v${version}/prek_linux_amd64.tar.gz"\n`,
      );
    }
    if (manager === "github-actions")
      writeFileSync(
        join(directory, ".github/workflows/ci.yml"),
        `name: CI\non: pull_request\njobs:\n  verify:\n    steps:\n      - uses: actions/checkout@v${version}\n      - run: task verify:all\n`,
      );
  };
  writeDependency("2.1.0");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");
  writeDependency("2.1.1");
  git("add", ".");
  git("commit", "--quiet", "-m", "helper update");
  const head = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  const tested = execFileSync(
    "git",
    ["commit-tree", tree, "-p", base, "-p", head],
    { cwd: directory, encoding: "utf8", input: "test merge\n" },
  ).trim();
  git("checkout", "--quiet", base);
  const identity = {
    repository: "owner/copied-template",
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
    user: { id: 29139614, login: "renovate[bot]", type: "Bot" },
    head: {
      sha: head,
      ref: "renovate/clsx",
      repo: { full_name: identity.repository },
    },
    base: { sha: base, ref: "main", repo: { full_name: identity.repository } },
  };
  writeFileSync(
    join(directory, "validation-identity.json"),
    JSON.stringify(identity),
  );
  execFileSync(
    "zip",
    ["-q", join(directory, "identity.zip"), "validation-identity.json"],
    { cwd: directory },
  );
  writeFileSync(
    join(directory, "event.json"),
    JSON.stringify({
      workflow_run: { id: 123, pull_requests: [{ number: 7 }] },
    }),
  );
  const env = {
    GITHUB_REPOSITORY: identity.repository,
    GITHUB_EVENT_PATH: join(directory, "event.json"),
    GITHUB_EVENT_NAME: "workflow_run",
    GITHUB_RUN_ID: "456",
    GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
    AI_ENABLED: "true",
    API_CONFIGURED: "true",
  };
  return {
    directory,
    manager,
    paths:
      manager === "mise"
        ? ["mise.toml", "mise.lock"]
        : manager === "github-actions"
          ? [".github/workflows/ci.yml"]
          : ["package.json", "bun.lock"],
    env,
    identity,
    pr,
    commit: { sha: tested, parents: [{ sha: base }, { sha: head }] },
  };
}

async function withFixture(t, callback, options) {
  const f = fixture(options);
  const cwd = process.cwd();
  const oldOutput = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = join(f.directory, "output.txt");
  const calls = [];
  let comments = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method ?? "GET", body: options.body });
    let value;
    if (path === "/repos/owner/copied-template")
      value = { default_branch: "main" };
    else if (path.endsWith("/pulls/7")) value = f.pr;
    else if (path.endsWith(`/commits/${f.identity.testedSha}`))
      value = f.commit;
    else if (path.endsWith("/actions/runs/123"))
      value = {
        id: 123,
        event: "pull_request",
        path: ".github/workflows/ci.yml",
        status: "completed",
        conclusion: "success",
        head_repository: { full_name: f.env.GITHUB_REPOSITORY },
        head_sha: f.identity.headSha,
      };
    else if (path.endsWith("/actions/runs/123/jobs"))
      value = {
        jobs: [
          "Validation scope",
          "Pre-PR validation",
          "Dependency validation",
        ].map((name) => ({ name, status: "completed", conclusion: "success" })),
      };
    else if (path.endsWith("/actions/runs/123/artifacts"))
      value = {
        artifacts: [
          {
            id: 99,
            name: "validation-identity",
            size_in_bytes: 1000,
            expired: false,
          },
        ],
      };
    else if (path.endsWith("/actions/artifacts/99/zip"))
      return new Response(readFileSync(join(f.directory, "identity.zip")));
    else if (path.endsWith("/pulls/7/files"))
      value = f.paths.map((filename) => ({
        filename,
        status: "modified",
      }));
    else if (path.endsWith("/issues/7/comments")) {
      if (options.method === "POST") {
        value = { id: 88 };
        comments = [
          {
            id: 88,
            user: { login: "github-actions[bot]" },
            body: JSON.parse(options.body).body,
          },
        ];
      } else value = comments;
    } else if (
      path.endsWith("/commits/v2.1.0") ||
      path.endsWith("/commits/v2.1.1")
    )
      value = {
        sha: path.endsWith("v2.1.0") ? "a".repeat(40) : "b".repeat(40),
      };
    else if (path.endsWith("/clsx/2.1.1"))
      value = {
        name: "clsx",
        version: "2.1.1",
        repository: "https://github.com/lukeed/clsx",
      };
    else if (path.endsWith("/releases/tags/v2.1.1"))
      value = {
        body: "Fix conditional class handling",
        html_url: "https://github.com/lukeed/clsx/releases/tag/v2.1.1",
      };
    else if (path.endsWith("/contents/CHANGELOG.md")) {
      assert.equal(new URL(url).searchParams.get("ref"), "b".repeat(40));
      const content = "## 2.1.1\nComplete tool changes\n## 2.1.0\nOld\n";
      value = {
        type: "file",
        path: "CHANGELOG.md",
        encoding: "base64",
        sha: "c".repeat(40),
        size: Buffer.byteLength(content),
        content: Buffer.from(content).toString("base64"),
      };
    } else throw new Error(`Unexpected fixture request ${path}`);
    return new Response(JSON.stringify(value));
  });
  process.chdir(f.directory);
  try {
    await callback(f, calls, (next) => {
      comments = next;
    });
  } finally {
    process.chdir(cwd);
    if (oldOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = oldOutput;
    rmSync(f.directory, { recursive: true, force: true });
  }
}

test("prepare uses data-only PR reads, current successful CI and complete evidence", async (t) =>
  withFixture(t, async (f, calls) => {
    const out = join(f.directory, "prepared");
    await prepare(out, f.env);
    const report = JSON.parse(readFileSync(join(out, "report.json")));
    assert.equal(report.status, "PENDING");
    assert.equal(report.eligibility.candidate, true);
    assert.equal(report.policy.model, "gpt-6.1-sol");
    assert.match(
      readFileSync(join(out, "prompt.md"), "utf8"),
      /UNTRUSTED EVIDENCE/,
    );
    assert.equal(
      existsSync(join(f.directory, "INSTALL_HOOK_MUST_NOT_RUN")),
      false,
    );
    assert.ok(calls.every((call) => call.method === "GET"));
    const evidence = JSON.parse(
      readFileSync(join(out, "prompt.md"), "utf8").split(
        "UNTRUSTED EVIDENCE (JSON):\n",
      )[1],
    );
    assert.deepEqual(evidence.ci.testedMerge.parents, [
      f.identity.baseSha,
      f.identity.headSha,
    ]);
    assert.equal(evidence.ci.testedMerge.sha, f.identity.testedSha);
    assert.equal(evidence.ci.testedMerge.relationshipValidated, true);
    assert.match(
      evidence.ci.trustedBaselineWorkflow.content,
      /task verify:all/,
    );
    assert.equal(evidence.lockfile.directEntries[0].before[0], "clsx@2.1.0");
    assert.equal(evidence.lockfile.directEntries[0].after[0], "clsx@2.1.1");
    assert.deepEqual(
      evidence.lockfile.changedPackages.map(({ name }) => name),
      ["clsx"],
    );
    assert.ok(
      evidence.usage.some(
        ({ path, content }) =>
          path === "src/usage.test.ts" &&
          content.includes("TEST_MUST_NOT_EXECUTE"),
      ),
    );
  }));

test("evidence distinguishes declaration-only updates and includes every transitive change", async (t) => {
  for (const transitive of [false, true])
    await withFixture(
      t,
      async (f) => {
        const out = join(f.directory, "prepared");
        await prepare(out, f.env);
        const evidence = JSON.parse(
          readFileSync(join(out, "prompt.md"), "utf8").split(
            "UNTRUSTED EVIDENCE (JSON):\n",
          )[1],
        );
        assert.deepEqual(
          evidence.lockfile.directEntries[0].before,
          evidence.lockfile.directEntries[0].after,
        );
        assert.deepEqual(
          evidence.lockfile.changedPackages.map(({ name }) => name),
          transitive ? ["indirect"] : [],
        );
        if (transitive) {
          assert.equal(
            evidence.lockfile.changedPackages[0].before[0],
            "indirect@1.0.0",
          );
          assert.equal(
            evidence.lockfile.changedPackages[0].after[0],
            "indirect@1.0.1",
          );
        }
      },
      { sameResolution: true, transitive },
    );
});

test("complete consumers and adjacent tests are bounded by bytes rather than a five-file cap", async (t) =>
  withFixture(
    t,
    async (f) => {
      const out = join(f.directory, "prepared");
      await prepare(out, f.env);
      let report = JSON.parse(readFileSync(join(out, "report.json")));
      assert.equal(report.status, "PENDING");
      const evidence = JSON.parse(
        readFileSync(join(out, "prompt.md"), "utf8").split(
          "UNTRUSTED EVIDENCE (JSON):\n",
        )[1],
      );
      assert.ok(evidence.usage.length > 5);
      const policyPath = join(f.directory, ".github/dependencies/policy.json");
      const policy = JSON.parse(readFileSync(policyPath));
      policy.maxContextBytes = 100;
      writeFileSync(policyPath, JSON.stringify(policy));
      const bounded = join(f.directory, "bounded");
      await prepare(bounded, f.env);
      report = JSON.parse(readFileSync(join(bounded, "report.json")));
      assert.equal(report.status, "NEEDS_HUMAN");
      assert.equal(report.complete, false);
      assert.equal(existsSync(join(bounded, "prompt.md")), false);
      assert.match(report.reason, /context byte limit/);
    },
    { tooManyTests: true },
  ));

test("missing setup, duplicate reviews and untrusted labels cannot initiate a paid run", async (t) =>
  withFixture(t, async (f, _calls, setComments) => {
    const out = join(f.directory, "prepared");
    await prepare(out, { ...f.env, API_CONFIGURED: "false" });
    let report = JSON.parse(readFileSync(join(out, "report.json")));
    assert.equal(report.status, "DISABLED");
    assert.equal(existsSync(join(out, "prompt.md")), false);
    setComments([
      {
        user: { login: "github-actions[bot]" },
        body: `<!-- dependency-review:${report.key} run:400 -->`,
      },
    ]);
    await prepare(out, f.env);
    report = JSON.parse(readFileSync(join(out, "report.json")));
    assert.equal(report.status, "DUPLICATE");
    f.pr.labels = [{ name: "automerge" }];
    f.pr.user.id = 1;
    await assert.rejects(prepare(out, f.env), /Renovate/);
  }));

test("base advancement after preparation prevents advisory publication", async (t) =>
  withFixture(t, async (f, calls) => {
    const out = join(f.directory, "prepared");
    await prepare(out, { ...f.env, AI_ENABLED: "false" });
    f.pr.base.sha = "d".repeat(40);
    await assert.rejects(publish(out, f.env), /Stale/);
    assert.ok(calls.every((call) => call.method === "GET"));
  }));

test("fresh advisory feedback is posted to the resolved copied repository", async (t) =>
  withFixture(t, async (f, calls) => {
    const out = join(f.directory, "prepared");
    await prepare(out, { ...f.env, AI_ENABLED: "false" });
    await publish(out, f.env);
    const post = calls.find((call) => call.method === "POST");
    assert.equal(post.path, "/repos/owner/copied-template/issues/7/comments");
    assert.match(JSON.parse(post.body).body, /trusted merge policy/);
  }));

test("preparation supports both policy modes and rejects inconsistent activation", async (t) =>
  withFixture(t, async (f) => {
    const path = join(f.directory, ".github/dependencies/policy.json");
    const policy = JSON.parse(readFileSync(path));
    const out = join(f.directory, "prepared");
    for (const automatic of [false, true]) {
      policy.mode = automatic ? "automatic" : "supervised";
      policy.automaticMerging = automatic;
      writeFileSync(path, JSON.stringify(policy));
      await prepare(out, f.env);
      const report = JSON.parse(readFileSync(join(out, "report.json")));
      assert.equal(report.status, "PENDING");
      assert.equal(report.policy.automaticMerging, automatic);
      policy.mode = automatic ? "supervised" : "automatic";
      writeFileSync(path, JSON.stringify(policy));
      await assert.rejects(prepare(out, f.env), /Unexpected review policy/);
    }
  }));

for (const manager of ["mise", "github-actions"])
  test(`${manager} updates reach complete data-only Sol preparation`, async (t) =>
    withFixture(
      t,
      async (f) => {
        const out = join(f.directory, "prepared");
        await prepare(out, f.env);
        const report = JSON.parse(readFileSync(join(out, "report.json")));
        assert.equal(report.status, "PENDING", report.reason);
        assert.equal(report.complete, true);
        assert.equal(report.eligibility.candidate, true);
        const evidence = JSON.parse(
          readFileSync(join(out, "prompt.md"), "utf8").split(
            "UNTRUSTED EVIDENCE (JSON):\n",
          )[1],
        );
        assert.equal(evidence.changes[0].manager, manager);
        assert.equal(evidence.releases[0].baseCommit, "a".repeat(40));
        assert.equal(evidence.releases[0].headCommit, "b".repeat(40));
        assert.ok(evidence.usage.length);
        if (manager === "mise") {
          for (const path of [
            "mise.lock",
            "prek.toml",
            "scripts/setup.sh",
            "scripts/skills/update.mjs",
          ])
            assert.ok(
              evidence.usage.some((entry) => entry.path === path),
              path,
            );
          assert.match(evidence.releases[0].notes, /Complete tool changes/);
        }
        assert.equal(
          existsSync(join(f.directory, "INSTALL_HOOK_MUST_NOT_RUN")),
          false,
        );
      },
      { manager },
    ));
