import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ci.mjs", import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "nexa-ci-scope-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  const manifest = { dependencies: { clsx: "^2.1.0" } };
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "README.md"), "Original documentation.\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const baseSha = git("rev-parse", "HEAD");
  const run = (command, env = {}) =>
    spawnSync(process.execPath, [script, command], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: join(directory, "output"),
        GITHUB_STEP_SUMMARY: join(directory, "summary"),
        ...env,
      },
    });
  const merge = (comparisonBase = baseSha) => {
    git("add", ".");
    git("commit", "--quiet", "-m", "PR change");
    const headSha = git("rev-parse", "HEAD");
    const testedSha = execFileSync(
      "git",
      [
        "commit-tree",
        git("rev-parse", "HEAD^{tree}"),
        "-p",
        comparisonBase,
        "-p",
        headSha,
      ],
      { cwd: directory, encoding: "utf8", input: "Synthetic merge\n" },
    ).trim();
    git("checkout", "--quiet", testedSha);
    return { baseSha: comparisonBase, headSha, testedSha };
  };
  return { directory, manifest, merge, run, git, baseSha };
}

for (const [path, database] of [
  ["README.md", false],
  ["package.json", true],
  ["supabase/migrations/001.sql", true],
  [".github/workflows/database.yml", true],
  ["supabase/seed.sql", true],
  ["supabase/tests/policy.sql", true],
  ["supabase/config.toml", true],
  ["scripts/database/smoke.mjs", true],
  ["scripts/dependencies/database-scope.mjs", true],
  ["mise.lock", true],
]) {
  test(`scope selects applicable database checks for ${path}`, (t) => {
    const f = fixture(t);
    const target = join(f.directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "Changed content.\n");
    const identity = f.merge();
    const result = f.run("scope", {
      EVENT_JSON: JSON.stringify({
        pull_request: { number: 7, head: { sha: identity.headSha } },
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(f.directory, "output"), "utf8"),
      `database=${database}\n`,
    );
    assert.equal(
      existsSync(join(f.directory, "validation-identity.json")),
      false,
    );
  });
}
test("scope rejects an unmerged or mismatched PR head", (t) => {
  const f = fixture(t);
  const event = { pull_request: { number: 7, head: { sha: "a".repeat(40) } } };
  assert.notEqual(
    f.run("scope", { EVENT_JSON: JSON.stringify(event) }).status,
    0,
  );
  writeFileSync(join(f.directory, "README.md"), "PR change.\n");
  f.merge();
  assert.notEqual(
    f.run("scope", { EVENT_JSON: JSON.stringify(event) }).status,
    0,
  );
});

test("push checks use changed paths and manual runs conservatively check the database", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "README.md"), "PR change.\n");
  const { baseSha } = f.merge();
  assert.equal(
    f.run("scope", { EVENT_JSON: JSON.stringify({ before: baseSha }) }).status,
    0,
  );
  assert.equal(
    readFileSync(join(f.directory, "output"), "utf8"),
    "database=false\n",
  );
  assert.equal(f.run("scope", { EVENT_JSON: "{}" }).status, 0);
  assert.equal(
    readFileSync(join(f.directory, "output"), "utf8"),
    "database=false\ndatabase=true\n",
  );
});

test("CI aggregate permits only successful required checks and an inapplicable database skip", (t) => {
  const f = fixture(t);
  const success = {
    scope: { result: "success" },
    verify: { result: "success" },
    database: { result: "success" },
  };
  for (const databaseRequired of ["true", "false"]) {
    const results = structuredClone(success);
    if (databaseRequired === "false") results.database.result = "skipped";
    assert.equal(
      f.run("aggregate", {
        RESULTS_JSON: JSON.stringify(results),
        DATABASE_REQUIRED: databaseRequired,
      }).status,
      0,
    );
    for (const name of ["scope", "verify", "database"]) {
      for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
        if (
          name === "database" &&
          databaseRequired === "false" &&
          outcome === "skipped"
        )
          continue;
        assert.notEqual(
          f.run("aggregate", {
            RESULTS_JSON: JSON.stringify({
              ...results,
              [name]: { result: outcome },
            }),
            DATABASE_REQUIRED: databaseRequired,
          }).status,
          0,
          `${name} ${outcome} with database required ${databaseRequired}`,
        );
      }
    }
  }
});

test("aggregate rejects a missing or invalid database applicability result", (t) => {
  const f = fixture(t);
  for (const value of ["", "TRUE", "unknown"]) {
    assert.notEqual(
      f.run("aggregate", {
        DATABASE_REQUIRED: value,
        RESULTS_JSON: JSON.stringify({
          scope: { result: "success" },
          verify: { result: "success" },
          database: { result: "skipped" },
        }),
      }).status,
      0,
    );
  }
});

for (const [description, mutate, expected] of [
  [
    "unrelated declaration",
    (manifest, lock) => {
      manifest.dependencies.clsx = "^2.1.1";
      lock.workspaces[""].dependencies.clsx = "^2.1.1";
    },
    false,
  ],
  [
    "unrelated transitive lockfile",
    (_manifest, lock) => {
      lock.packages.helper[0] = "helper@1.1.0";
    },
    false,
  ],
  [
    "CLI transitive lockfile",
    (_manifest, lock) => {
      lock.packages.jose[0] = "jose@6.1.0";
    },
    true,
  ],
  [
    "mixed relevant and unrelated updates",
    (manifest, lock) => {
      manifest.dependencies.clsx = "^2.1.1";
      lock.packages.supabase[0] = "supabase@2.1.0";
    },
    true,
  ],
]) {
  test(`hosted scope output for ${description}`, (t) => {
    const f = fixture(t);
    const manifest = {
      dependencies: { clsx: "^2.1.0" },
      devDependencies: { supabase: "^2.0.0" },
    };
    const lock = {
      lockfileVersion: 1,
      workspaces: { "": structuredClone(manifest) },
      packages: {
        clsx: ["clsx@2.1.0", "", { dependencies: { helper: "1.0.0" } }],
        helper: ["helper@1.0.0", "", {}],
        supabase: ["supabase@2.0.0", "", { dependencies: { jose: "6.0.0" } }],
        jose: ["jose@6.0.0", "", {}],
      },
    };
    const write = () => {
      writeFileSync(
        join(f.directory, "package.json"),
        JSON.stringify(manifest),
      );
      writeFileSync(join(f.directory, "bun.lock"), JSON.stringify(lock));
    };
    write();
    f.git("add", ".");
    f.git("commit", "--quiet", "-m", "dependency baseline");
    const before = f.git("rev-parse", "HEAD");
    mutate(manifest, lock);
    write();
    const { headSha } = f.merge(before);
    for (const event of [
      { before },
      { pull_request: { head: { sha: headSha } } },
    ]) {
      writeFileSync(join(f.directory, "output"), "");
      const result = f.run("scope", { EVENT_JSON: JSON.stringify(event) });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(join(f.directory, "output"), "utf8"),
        `database=${expected}\n`,
      );
    }
  });
}
