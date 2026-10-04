import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  command,
  renderReport,
  repositoryFromRemote,
  runUpdate,
  validateProposal,
} from "./update.mjs";

const template = readFileSync(
  new URL("../../.github/pull_request_template.md", import.meta.url),
  "utf8",
);
const proposal = {
  cliVersion: "1.5.26",
  changes: [
    {
      name: "example",
      source: "owner/source",
      skillPath: "skills/example/SKILL.md",
      previousRef: null,
      previousHash: "oldhash",
      ref: "a".repeat(40),
      computedHash: "newhash",
    },
  ],
  pending: [],
};

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "skill-run-test-"));
  command(cwd, "git", ["init", "--quiet"]);
  command(cwd, "git", ["config", "user.email", "test@example.invalid"]);
  command(cwd, "git", ["config", "user.name", "Test"]);
  command(cwd, "git", ["config", "core.hooksPath", "/dev/null"]);
  command(cwd, "git", [
    "remote",
    "add",
    "origin",
    `https://github.com/${process.env.GITHUB_REPOSITORY || "owner/project"}.git`,
  ]);
  mkdirSync(join(cwd, ".github"));
  mkdirSync(join(cwd, ".agents/skills/example"), { recursive: true });
  mkdirSync(join(cwd, ".agents/licenses"));
  writeFileSync(join(cwd, ".github/pull_request_template.md"), template);
  writeFileSync(join(cwd, ".agents/skills/example/SKILL.md"), "old");
  writeFileSync(join(cwd, "skills-lock.json"), "{}");
  command(cwd, "git", ["add", "."]);
  command(cwd, "git", ["commit", "--quiet", "-m", "fixture"]);
  return cwd;
}

test("resolve the running origin without gh defaults or fixed Nexa identity", () => {
  assert.equal(
    repositoryFromRemote("git@github.com:owner/fork.git"),
    "owner/fork",
  );
  assert.equal(
    repositoryFromRemote("https://github.com/owner/fork"),
    "owner/fork",
  );
  assert.throws(() => repositoryFromRemote("https://evil.invalid/owner/fork"));
});

test("reports preserve every template heading and unknown provenance", () => {
  const report = renderReport(
    template,
    proposal,
    [{ command: "mise exec -- task verify", outcome: "passed" }],
    "https://github.com/owner/project/actions/runs/1",
  );
  assert.deepEqual(report.match(/^## .+$/gm), template.match(/^## .+$/gm));
  assert.match(report, /unknown \(not recorded\)/);
  assert.match(report, /mise exec -- task verify/);
  assert.match(report, /manual review and merging/);
  assert.throws(
    () =>
      renderReport(`${template}\n## New obligation\n\nFill me\n`, proposal, []),
    /New obligation/,
  );
});

test("validation compares upstream bytes only after verify and hooks pass", async () => {
  const calls = [];
  await validateProposal({
    cwd: "unused",
    prepared: proposal,
    run: (_cwd, _file, args) => {
      calls.push(args.at(-1));
      return "";
    },
    compare: async () => {
      calls.push("compare");
    },
  });
  assert.deepEqual(calls, ["verify", "hooks:run", "compare"]);
  const failed = [];
  await assert.rejects(
    validateProposal({
      cwd: "unused",
      prepared: proposal,
      run: (_cwd, _file, args) => {
        failed.push(args.at(-1));
        throw new Error("failed check");
      },
      compare: async () => {
        failed.push("compare");
      },
    }),
    /failed check/,
  );
  assert.deepEqual(failed, ["verify"]);
});

test("changed local proposal is isolated and validation failure cannot publish", async (context) => {
  const previousActions = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  context.after(() => {
    if (previousActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previousActions;
  });
  for (const failure of [false, true]) {
    const cwd = fixture();
    let published = false;
    const outputDir = mkdtempSync(join(tmpdir(), "skill-output-test-"));
    const options = {
      cwd,
      outputDir,
      summaryPath: null,
      shouldPublish: failure,
      run: (root, file, args) =>
        file === "mise" ? "" : command(root, file, args),
      prepareSkills: async ({ cwd: checkout }) => {
        assert.notEqual(checkout, cwd);
        mkdirSync(join(checkout, ".agents/licenses"), { recursive: true });
        writeFileSync(
          join(checkout, ".agents/skills/example/SKILL.md"),
          "updated",
        );
        return proposal;
      },
      validate: async () => {
        if (failure) throw new Error("fixture validation failure");
        return [{ command: "fixture validation", outcome: "passed" }];
      },
      publishChanges: () => {
        published = true;
      },
    };
    if (failure)
      await assert.rejects(runUpdate(options), /fixture validation failure/);
    else
      assert.equal(
        (await runUpdate(options)).status,
        "validated-local-proposal",
      );
    assert.equal(
      readFileSync(join(cwd, ".agents/skills/example/SKILL.md"), "utf8"),
      "old",
    );
    assert.equal(published, false);
    const result = JSON.parse(
      readFileSync(join(outputDir, "result.json"), "utf8"),
    );
    assert.equal(
      result.status,
      failure ? "failed" : "validated-local-proposal",
    );
  }
});

test("no-change and pending review do not validate or publish, failed sources fail", async () => {
  for (const scenario of ["no-change", "pending-review", "failed-source"]) {
    const cwd = fixture();
    const outputDir = mkdtempSync(join(tmpdir(), "skill-output-test-"));
    const options = {
      cwd,
      outputDir,
      summaryPath: null,
      run: (root, file, args) =>
        file === "mise" ? "" : command(root, file, args),
      prepareSkills: async () => {
        if (scenario === "failed-source") throw new Error("source unavailable");
        return {
          cliVersion: "1.5.26",
          changes: [],
          pending:
            scenario === "pending-review"
              ? [{ name: "github-issues", ref: "b".repeat(40) }]
              : [],
        };
      },
      validate: async () => {
        assert.fail("must not validate an empty/failed proposal");
      },
      publishChanges: () => {
        assert.fail("must not publish an empty/failed proposal");
      },
    };
    if (scenario === "failed-source")
      await assert.rejects(runUpdate(options), /source unavailable/);
    else assert.equal((await runUpdate(options)).status, scenario);
  }
});

test("validation cannot add an untracked skill outside the prepared manifest", async () => {
  await assert.rejects(
    runUpdate({
      cwd: fixture(),
      summaryPath: null,
      run: (root, file, args) =>
        file === "mise" ? "" : command(root, file, args),
      prepareSkills: async ({ cwd, scratch }) => {
        assert.notEqual(scratch, join(cwd, ".."));
        mkdirSync(join(cwd, ".agents/licenses"), { recursive: true });
        writeFileSync(join(cwd, ".agents/skills/example/SKILL.md"), "updated");
        return proposal;
      },
      validate: async ({ cwd }) => {
        mkdirSync(join(cwd, ".agents/skills/unselected"));
        writeFileSync(
          join(cwd, ".agents/skills/unselected/SKILL.md"),
          "unexpected",
        );
        return [];
      },
      publishChanges: () => assert.fail("must never publish unexpected files"),
    }),
    /protected\/unselected file/,
  );
});
