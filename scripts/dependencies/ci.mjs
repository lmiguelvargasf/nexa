import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { databaseDependenciesChanged, parseLock } from "./database-scope.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DATABASE_PATHS = new Set([
  "bunfig.toml",
  "mise.toml",
  "mise.lock",
  "Taskfile.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/database.yml",
]);

export function databaseApplicable(paths, readSnapshots) {
  if (
    paths.some(
      (path) =>
        DATABASE_PATHS.has(path) ||
        path.startsWith("supabase/") ||
        path.startsWith("scripts/database/") ||
        path.startsWith("scripts/dependencies/ci.") ||
        path.startsWith("scripts/dependencies/database-scope."),
    )
  )
    return true;
  if (!paths.some((path) => ["package.json", "bun.lock"].includes(path)))
    return false;
  try {
    const [before, after] = readSnapshots();
    return databaseDependenciesChanged(before, after);
  } catch (error) {
    console.error(
      `Database dependency comparison unavailable; requiring validation: ${error.message}`,
    );
    return true;
  }
}

export function assertValidation(results, databaseRequired) {
  for (const name of ["scope", "verify", "database"]) {
    const expected =
      name === "database" && !databaseRequired ? "skipped" : "success";
    if (results[name]?.result !== expected) {
      throw new Error(
        `${name}: expected ${expected}, received ${results[name]?.result ?? "missing"}`,
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const command = process.argv[2];
  if (command === "scope") {
    const event = JSON.parse(process.env.EVENT_JSON);
    const testedSha = git("rev-parse", "HEAD");
    const pr = event.pull_request;
    let paths;
    let comparisonBase;
    if (pr) {
      const parents = git("rev-list", "--parents", "-n", "1", "HEAD")
        .split(" ")
        .slice(1);
      if (parents.length !== 2 || parents[1] !== pr.head.sha)
        throw new Error("CI must test this PR's synthetic merge commit");
      comparisonBase = git("merge-base", parents[0], parents[1]);
      paths = git("diff", "--name-only", comparisonBase, parents[1])
        .split("\n")
        .filter(Boolean);
    } else {
      const before = event.before;
      comparisonBase =
        SHA.test(before ?? "") && !/^0+$/.test(before) ? before : undefined;
      paths =
        SHA.test(before ?? "") && !/^0+$/.test(before)
          ? git("diff", "--name-only", before, testedSha).split("\n")
          : git("ls-files").split("\n");
    }
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `database=${databaseApplicable(paths, () => {
        if (!comparisonBase) throw new Error("No comparison base");
        return [comparisonBase, testedSha].map((revision) => ({
          manifest: JSON.parse(git("show", `${revision}:package.json`)),
          lock: parseLock(git("show", `${revision}:bun.lock`)),
        }));
      })}\n`,
    );
  } else if (command === "aggregate") {
    if (!["true", "false"].includes(process.env.DATABASE_REQUIRED))
      throw new Error("Missing CI applicability result");
    assertValidation(
      JSON.parse(process.env.RESULTS_JSON),
      process.env.DATABASE_REQUIRED === "true",
    );
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "Frozen install, formatting/lint, types, unit/automation tests, production build, browser smoke, Renovate configuration, and the audit gate passed (see Pre-PR validation for temporary advisory exceptions).\n\nDatabase validation: " +
        (process.env.DATABASE_REQUIRED === "true"
          ? "passed (absent pgTAP tests do not establish database behavior)."
          : "not applicable to changed paths.") +
        "\n",
    );
  } else throw new Error("Use scope or aggregate");
}
