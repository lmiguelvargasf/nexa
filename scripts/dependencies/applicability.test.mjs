import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  fetchApplicability,
  inspectApplicability,
  readApplicability,
} from "./applicability.mjs";

const snapshot = (path, before, after) => ({
  paths: [path],
  before: { [path]: before },
  after: { [path]: after },
});
const manifest = (before, after) =>
  snapshot("package.json", JSON.stringify(before), JSON.stringify(after));
const workflow = (pin = "actions/checkout@v6", command = "task verify") =>
  `on: [push, pull_request]\njobs:\n  verify:\n    steps:\n      - uses: ${pin}\n      - run: ${command}\n`;
const actions = (before, after, path = ".github/workflows/ci.yml") =>
  snapshot(path, before, after);
const applicable = (data) => inspectApplicability(data).applicable;

test("ordinary application/documentation changes and manifest scripts do not enter policy", () => {
  assert.equal(applicable(snapshot("src/app/page.tsx", "old", "new")), false);
  assert.equal(
    applicable(snapshot("docs/readme.md", null, "New document")),
    false,
  );
  assert.equal(
    applicable(
      manifest({ scripts: { test: "old" } }, { scripts: { test: "new" } }),
    ),
    false,
  );
  assert.equal(
    applicable(
      manifest(
        { name: "old", description: "old" },
        { name: "new", description: "new" },
      ),
    ),
    false,
  );
  assert.equal(applicable({ paths: [], before: {}, after: {} }), false);
});

test("all package categories, additions, removals and ineligible versions stay applicable", () => {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "overrides",
    "resolutions",
  ])
    for (const [before, after] of [
      [{}, { [field]: { example: "1.2.3" } }],
      [{ [field]: { example: "1.2.3" } }, {}],
      [{ [field]: { example: "1.2.3" } }, { [field]: { example: "2.0.0" } }],
      [
        { [field]: { example: "1.2.3" } },
        { [field]: { example: "git+https://example.com/repo.git" } },
      ],
    ])
      assert.equal(applicable(manifest(before, after)), true, field);
  assert.equal(
    applicable(
      snapshot(
        "packages/sub/package.json",
        null,
        '{"dependencies":{"new":"*"}}',
      ),
    ),
    true,
  );
  assert.equal(
    applicable(
      snapshot("package.json", '{"dependencies":{"old":"1.0.0"}}', null),
    ),
    true,
  );
});

test("runtime, workspace and install trust policy are dependency evidence", () => {
  for (const [field, value] of [
    ["packageManager", "bun@1.4.2"],
    ["engines", { node: ">=24" }],
    ["devEngines", { runtime: { name: "node", version: "24" } }],
    ["trustedDependencies", ["new-hook"]],
    ["ignoreScripts", ["new-hook"]],
    ["workspaces", ["packages/*"]],
    ["catalogs", { default: { zod: "^4" } }],
    ["installConfig", { hoistingLimits: "workspaces" }],
    ["peerDependenciesMeta", { react: { optional: true } }],
  ])
    assert.equal(applicable(manifest({}, { [field]: value })), true, field);
  assert.equal(
    applicable(
      snapshot(
        "bunfig.toml",
        "[install]\nminimumReleaseAge = 259200\n",
        "[install]\nminimumReleaseAge = 0\n",
      ),
    ),
    true,
  );
  assert.equal(
    applicable(
      snapshot(
        "bunfig.toml",
        "[test]\ntimeout = 10\n",
        "[test]\ntimeout = 20\n",
      ),
    ),
    false,
  );
});

test("semantic manifest and tool comparisons ignore formatting/key order/comments", () => {
  assert.equal(
    applicable(
      snapshot(
        "package.json",
        '{"dependencies":{"a":"1","b":"2"}}',
        '{\n "dependencies": { "b": "2", "a": "1" }\n}',
      ),
    ),
    false,
  );
  assert.equal(
    applicable(
      snapshot(
        "mise.toml",
        '[tools]\nnode="24.0.0"\n',
        '# comment\n[tools]\nnode = "24.0.0"\n',
      ),
    ),
    false,
  );
  assert.equal(
    applicable(
      snapshot(
        "bunfig.toml",
        "[install]\nminimumReleaseAge=3\n",
        "# comment\n[install]\nminimumReleaseAge = 3\n",
      ),
    ),
    false,
  );
});

test("any Bun or mise lock content change, including transitive-only, is applicable", () => {
  for (const path of ["bun.lock", "bun.lockb", "mise.lock"])
    for (const [before, after] of [
      ["same", "changed"],
      [null, "added"],
      ["removed", null],
    ])
      assert.equal(applicable(snapshot(path, before, after)), true);
});

test("tool versions and install settings apply while ordinary mise tasks/settings do not", () => {
  for (const [before, after] of [
    ['[tools]\nnode="24.0.0"\n', '[tools]\nnode="25.0.0"\n'],
    ["", '[tools]\nbun="1.4.2"\n'],
    ['[tools]\nbun="1.4.2"\n', ""],
    ["[settings]\nlockfile=true\n", "[settings]\nlockfile=false\n"],
  ])
    assert.equal(applicable(snapshot("mise.toml", before, after)), true);
  assert.equal(
    applicable(
      snapshot(
        "mise.toml",
        '[settings]\nverbose=false\n[tasks.build]\nrun="old"\n',
        '[settings]\nverbose=true\n[tasks.build]\nrun="new"\n',
      ),
    ),
    false,
  );
});

test("human and mixed changes classify by content independently of eligibility or metadata", () => {
  const data = manifest(
    { dependencies: { next: "16.0.0" } },
    { dependencies: { next: "17.0.0-beta.1" } },
  );
  data.paths.push("src/app/page.tsx", "docs/readme.md");
  for (const author of ["human", "renovate[bot]"])
    assert.equal(
      applicable({
        ...data,
        author,
        branch: "ordinary-work",
        labels: [],
        candidate: false,
      }),
      true,
    );
});

test("remote Action major/digest/source updates and addition/removal remain in scope", () => {
  for (const pin of [
    "actions/checkout@v7",
    `actions/checkout@${"a".repeat(40)}`,
    "other/action@main",
    "docker://alpine:3",
  ])
    assert.equal(applicable(actions(workflow(), workflow(pin))), true);
  assert.equal(applicable(actions(null, workflow())), true);
  assert.equal(applicable(actions(workflow(), null)), true);
  assert.equal(
    applicable(
      actions(
        workflow(),
        workflow().replace("      - uses: actions/checkout@v6\n", ""),
      ),
    ),
    true,
  );
  assert.equal(
    applicable(
      actions(
        "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v6\n",
        "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n",
        ".github/actions/setup/action.yml",
      ),
    ),
    true,
  );
  assert.equal(
    applicable(actions(workflow(), workflow().replace("uses:", '"uses":'))),
    false,
  );
  assert.equal(
    applicable(
      actions(
        workflow(),
        workflow().replace("uses:", "'uses':").replace("@v6", "@v7"),
      ),
    ),
    true,
  );
});

test("workflow commands, comments, local actions and embedded scripts do not invent pins", () => {
  assert.equal(
    applicable(
      actions(workflow(), workflow("actions/checkout@v6", "task verify:all")),
    ),
    false,
  );
  assert.equal(
    applicable(actions(workflow(), `${workflow()}# uses: actions/fake@v7\n`)),
    false,
  );
  assert.equal(
    applicable(actions(workflow("./local/one"), workflow("./local/two"))),
    false,
  );
  assert.equal(
    applicable(actions(workflow(), workflow().replace("@v6", "@v6 # v6.1.0"))),
    false,
  );
  const before =
    "jobs:\n  test:\n    steps:\n      - run: |\n          cat <<EOF\n          uses: actions/example@v1\n          EOF\n      - uses: actions/checkout@v6\n";
  assert.equal(
    applicable(actions(before, before.replace("example@v1", "example@v2"))),
    false,
  );
  assert.equal(
    applicable(actions(before, before.replace("checkout@v6", "checkout@v7"))),
    true,
  );
  for (const name of [
    "ci",
    "database",
    "dependency-review",
    "dependency-merge-policy",
    "skill-updates",
  ]) {
    const content = readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    assert.equal(
      applicable(actions(content, `${content}\n# ordinary comment\n`)),
      false,
      name,
    );
  }
});

test("unsupported YAML and ambiguous Action references stay in scope for manual review", () => {
  for (const content of [
    "jobs: {test: {steps: [{uses: actions/checkout@v7}]}}\n",
    "jobs:\n  test: &job\n    steps:\n      - uses: actions/checkout@v7\n",
    "jobs:\n  test: *job\n",
    "jobs:\n  test:\n    <<: *job\n",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression fixture.
    "jobs:\n  test:\n    steps:\n      - uses: ${{ inputs.action }}\n",
    "jobs:\n  test:\n    steps:\n      - uses: |\n          actions/checkout@v7\n",
    'jobs:\n  test:\n    steps:\n      - "uses": "actions/checkout@\n          v7"\n',
  ]) {
    const result = inspectApplicability(actions(workflow(), content));
    assert.equal(result.applicable, true);
    assert.match(result.reasons.join(" "), /conservative dependency review/);
  }
});

test("missing, malformed or inconsistent evidence never becomes non-applicable", () => {
  for (const data of [
    { paths: ["package.json"], before: {}, after: {} },
    snapshot("package.json", "{}", "invalid"),
    snapshot("package.json", "{}", "null"),
    snapshot("mise.toml", "[tools]\n", "bad toml"),
    snapshot("package.json", null, null),
    { paths: ["docs.md", "docs.md"], before: {}, after: {} },
  ])
    assert.throws(() => applicable(data));
});

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "nexa-applicability-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "--quiet", "-b", "main");
  git("config", "user.name", "Applicability test");
  git("config", "user.email", "test@example.invalid");
  const write = (path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = () => {
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "-m", "Fixture");
    return git("rev-parse", "HEAD");
  };
  write("package.json", '{"dependencies":{"example":"1.0.0"}}\n');
  const initial = commit();
  return { cwd, git, write, commit, initial };
}

test("Git reader uses the complete PR merge-base diff instead of unrelated base advances", (t) => {
  const repo = repository(t);
  repo.write("package.json", '{"dependencies":{"example":"2.0.0"}}\n');
  const baseSha = repo.commit();
  repo.git("checkout", "--quiet", "-b", "topic", repo.initial);
  repo.write("docs/name\twith\nnewlines.md", "ordinary");
  const headSha = repo.commit();
  assert.equal(readApplicability({ baseSha, headSha }, repo).applicable, false);
  repo.write("package.json", '{"dependencies":{"example":"3.0.0"}}\n');
  assert.equal(
    readApplicability({ baseSha, headSha: repo.commit() }, repo).applicable,
    true,
  );
});

test("Git reader treats renames as complete removals/additions and reads binary locks", (t) => {
  const repo = repository(t);
  renameSync(
    join(repo.cwd, "package.json"),
    join(repo.cwd, "old-manifest.json"),
  );
  assert.equal(
    readApplicability({ baseSha: repo.initial, headSha: repo.commit() }, repo)
      .applicable,
    true,
  );
  repo.write("bun.lockb", Buffer.from([255, 0, 254]));
  assert.equal(
    readApplicability({ baseSha: repo.initial, headSha: repo.commit() }, repo)
      .applicable,
    true,
  );
});

test("Git reader rejects invalid revisions, missing objects and dependency symlinks", (t) => {
  const repo = repository(t);
  for (const headSha of ["--help", "b".repeat(40)])
    assert.throws(() =>
      readApplicability({ baseSha: repo.initial, headSha }, repo),
    );
  assert.throws(
    () =>
      fetchApplicability({ baseSha: "--help", headSha: repo.initial }, repo),
    /Invalid baseSha/,
  );
  rmSync(join(repo.cwd, "package.json"));
  symlinkSync("missing", join(repo.cwd, "package.json"));
  assert.throws(
    () =>
      readApplicability(
        { baseSha: repo.initial, headSha: repo.commit() },
        repo,
      ),
    /regular file/,
  );
});

test("shallow evidence fails closed and trusted fetching restores history without checkout", (t) => {
  const repo = repository(t);
  repo.write("README.md", "ordinary");
  const headSha = repo.commit();
  const clone = mkdtempSync(join(tmpdir(), "nexa-applicability-shallow-"));
  t.after(() => rmSync(clone, { recursive: true, force: true }));
  execFileSync("git", [
    "clone",
    "--quiet",
    "--depth=1",
    pathToFileURL(repo.cwd).href,
    clone,
  ]);
  const identity = { baseSha: repo.initial, headSha };
  assert.throws(
    () => readApplicability(identity, { cwd: clone }),
    /Complete Git history/,
  );
  assert.equal(fetchApplicability(identity, { cwd: clone }).applicable, false);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: clone,
      encoding: "utf8",
    }).trim(),
    headSha,
  );
});

test("workflow containers/services, runner labels and version inputs are dependencies", () => {
  for (const [before, after] of [
    [
      "jobs:\n  test:\n    container: node:24\n",
      "jobs:\n  test:\n    container: node:25\n",
    ],
    [
      "jobs:\n  test:\n    container:\n      image: node:24\n",
      "jobs:\n  test:\n    container:\n      image: node:25\n",
    ],
    [
      "jobs:\n  test:\n    services:\n      postgres:\n        image: postgres:16\n",
      "jobs:\n  test:\n    services:\n      postgres:\n        image: postgres:17\n",
    ],
    [
      "jobs:\n  test:\n    runs-on: ubuntu-22.04\n",
      "jobs:\n  test:\n    runs-on: ubuntu-24.04\n",
    ],
    [
      "jobs:\n  test:\n    runs-on: [self-hosted, linux]\n",
      "jobs:\n  test:\n    runs-on: [self-hosted, windows]\n",
    ],
    ["runs:\n  using: node20\n", "runs:\n  using: node24\n"],
    [
      "runs:\n  using: docker\n  image: docker://alpine:3\n",
      "runs:\n  using: docker\n  image: docker://alpine:4\n",
    ],
  ])
    assert.equal(applicable(actions(before, after)), true);
  for (const key of [
    "codex-version",
    "proxy-version",
    "node-version",
    "bun-version",
    "python-version",
    "tool-version",
    "version",
  ]) {
    const before = `${workflow()}        with:\n          ${key}: '1.0.0'\n`;
    assert.equal(
      applicable(actions(before, before.replace("1.0.0", "2.0.0"))),
      true,
      key,
    );
  }
  assert.equal(
    applicable(
      actions(
        "jobs:\n  test:\n    runs-on:\n      - self-hosted\n      - linux\n",
        "jobs:\n  test:\n    runs-on:\n      - self-hosted\n      - windows\n",
      ),
    ),
    true,
  );
  const runner =
    "jobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: task verify\n";
  assert.equal(
    applicable(
      actions(
        runner,
        `${runner}  compatibility:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: exit 0\n`,
      ),
    ),
    false,
  );
  const dynamic = `jobs:\n  test:\n    runs-on: \${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-22.04]\n`;
  assert.equal(
    applicable(
      actions(dynamic, dynamic.replace("ubuntu-22.04", "ubuntu-24.04")),
    ),
    true,
  );
  const reviewer = readFileSync(
    new URL("../../.github/workflows/dependency-review.yml", import.meta.url),
    "utf8",
  );
  assert.equal(
    applicable(
      actions(
        reviewer,
        reviewer.replace("codex-version: 0.160.0", "codex-version: 0.161.0"),
      ),
    ),
    true,
  );
  assert.equal(
    applicable(
      actions(
        "jobs:\n  test:\n    runs-on: [self-hosted, linux]\n",
        'jobs:\n  test:\n    runs-on: [ "linux", "self-hosted" ] # formatting\n',
      ),
    ),
    false,
  );
});

test("patch declarations, patch content and Action lockfile resolutions remain applicable", () => {
  assert.equal(
    applicable(
      manifest(
        {},
        { patchedDependencies: { "example@1.0.0": "patches/example.patch" } },
      ),
    ),
    true,
  );
  for (const path of [
    "patches/example.patch",
    "patches/custom-filename",
    "other/example.patch",
    ".github/workflows/actions.lock",
  ]) {
    assert.equal(
      applicable(snapshot(path, "old bytes", "new bytes")),
      true,
      path,
    );
    assert.equal(applicable(snapshot(path, null, "new bytes")), true, path);
    assert.equal(applicable(snapshot(path, "old bytes", null)), true, path);
  }
});
