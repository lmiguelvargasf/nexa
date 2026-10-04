import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { assertValidation, databaseApplicable, SHA } from "./policy.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const command = process.argv[2];
if (command === "scope") {
  const event = JSON.parse(process.env.EVENT_JSON);
  const testedSha = git("rev-parse", "HEAD");
  const parents = git("rev-list", "--parents", "-n", "1", "HEAD")
    .split(" ")
    .slice(1);
  const pr = event.pull_request;
  let paths;
  let identity;
  if (pr) {
    if (parents.length !== 2 || parents[1] !== pr.head.sha)
      throw new Error("CI must test this PR's synthetic merge commit");
    paths = git("diff", "--name-only", `${parents[0]}...${parents[1]}`)
      .split("\n")
      .filter(Boolean);
    identity = {
      repository: process.env.GITHUB_REPOSITORY,
      prNumber: pr.number,
      headSha: parents[1],
      baseSha: parents[0],
      testedSha,
      runId: Number(process.env.GITHUB_RUN_ID),
    };
  } else {
    const before = event.before;
    paths =
      SHA.test(before ?? "") && !/^0+$/.test(before)
        ? git("diff", "--name-only", before, testedSha).split("\n")
        : git("ls-files").split("\n");
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `database=${databaseApplicable(paths)}\n`,
  );
  if (identity)
    writeFileSync("validation-identity.json", `${JSON.stringify(identity)}\n`);
} else if (command === "aggregate") {
  if (!["true", "false"].includes(process.env.DATABASE_REQUIRED))
    throw new Error("Missing CI applicability result");
  assertValidation(
    JSON.parse(process.env.RESULTS_JSON),
    process.env.DATABASE_REQUIRED === "true",
  );
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "Frozen install, formatting/lint, types, unit/automation tests, production build, browser smoke, and the audit gate passed (see Pre-PR validation for temporary advisory exceptions).\n\nDatabase validation: " +
      (process.env.DATABASE_REQUIRED === "true"
        ? "passed (absent pgTAP tests do not establish database behavior)."
        : "not applicable to changed paths.") +
      "\n",
  );
} else throw new Error("Use scope or aggregate");
