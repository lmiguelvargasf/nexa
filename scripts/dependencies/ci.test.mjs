import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

for (const dependency of [false, true]) {
  test(`scope reports exact PR applicability (${dependency ? "dependency" : "documentation"})`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.directory, "README.md"), "Updated documentation.\n");
    if (dependency) {
      f.manifest.dependencies.clsx = "^2.1.1";
      writeFileSync(
        join(f.directory, "package.json"),
        JSON.stringify(f.manifest),
      );
    }
    const identity = f.merge();
    const result = f.run("scope", {
      EVENT_JSON: JSON.stringify({
        pull_request: { number: 7, head: { sha: identity.headSha } },
      }),
      GITHUB_REPOSITORY: "owner/copied-template",
      GITHUB_RUN_ID: "123",
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = readFileSync(join(f.directory, "summary"), "utf8");
    assert.ok(
      summary.includes(`**${dependency ? "applies" : "not applicable"}**`),
    );
    for (const sha of Object.values(identity)) assert.ok(summary.includes(sha));
    assert.match(summary, /diagnostic only/);
    assert.equal(
      readFileSync(join(f.directory, "output"), "utf8"),
      `database=${dependency}\n`,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(f.directory, "validation-identity.json"))),
      {
        repository: "owner/copied-template",
        prNumber: 7,
        ...identity,
        runId: 123,
      },
    );
  });
}

test("scope fails closed and explains unreadable applicability evidence", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "package.json"), "{malformed");
  const identity = f.merge();
  const result = f.run("scope", {
    EVENT_JSON: JSON.stringify({
      pull_request: { number: 7, head: { sha: identity.headSha } },
    }),
  });
  assert.notEqual(result.status, 0);
  const summary = readFileSync(join(f.directory, "summary"), "utf8");
  assert.match(summary, /validation fails closed/);
  assert.ok(summary.includes(identity.headSha));
  assert.ok(summary.includes(identity.baseSha));
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

test("legacy required-check alias always evaluates and fails unless CI validation succeeds", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /aggregate:\n {4}name: CI validation\n/);
  const legacy = workflow.slice(workflow.indexOf("  legacy-aggregate:\n"));
  assert.match(legacy, /name: Dependency validation\n/);
  assert.match(legacy, /needs: aggregate\n {4}if: always\(\)\n/);
  assert.match(
    legacy,
    /AGGREGATE_RESULT: \$\{\{ needs\.aggregate\.result \}\}/,
  );
  const command = legacy.match(/ {8}run: (.+)\n/)[1];
  for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
    const run = spawnSync("sh", ["-c", command], {
      env: { ...process.env, AGGREGATE_RESULT: result },
    });
    assert.equal(run.status === 0, result === "success", result);
  }
});
