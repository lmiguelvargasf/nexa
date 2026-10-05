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
  const merge = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "PR change");
    const headSha = git("rev-parse", "HEAD");
    const testedSha = execFileSync(
      "git",
      [
        "commit-tree",
        git("rev-parse", "HEAD^{tree}"),
        "-p",
        baseSha,
        "-p",
        headSha,
      ],
      { cwd: directory, encoding: "utf8", input: "Synthetic merge\n" },
    ).trim();
    git("checkout", "--quiet", testedSha);
    return { baseSha, headSha, testedSha };
  };
  return { directory, manifest, merge, run };
}

for (const [path, database] of [
  ["README.md", false],
  ["package.json", true],
  ["supabase/migrations/001.sql", true],
  [".github/workflows/database.yml", true],
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
