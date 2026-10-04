import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchSource,
  hashDirectory,
  hashLicenses,
  licenseFiles,
} from "./prepare.mjs";

// Download for inspection only. This command never installs or records approval.
const ref = process.argv[2];
if (process.argv.length !== 3 || !/^[a-f0-9]{40}$/.test(ref || "")) {
  console.error(
    "Usage: mise exec -- bun scripts/skills/review-candidate.mjs <full-upstream-commit>",
  );
  process.exitCode = 1;
} else {
  const source = "github/awesome-copilot";
  const skillPath = "skills/github-issues/SKILL.md";
  const directory = mkdtempSync(join(tmpdir(), "github-issues-review-"));
  await fetchSource({ source, ref, directory });
  console.log(
    `Candidate downloaded to ${directory}. Review the entire skill, references, and licenses before recording approval.`,
  );
  console.log(
    `Applicable licenses: ${licenseFiles(directory, skillPath).join(", ")}`,
  );
  console.log(
    JSON.stringify(
      {
        source,
        skillPath,
        ref,
        computedHash: hashDirectory(join(directory, "skills/github-issues")),
        licenseHash: hashLicenses(directory, skillPath),
      },
      null,
      2,
    ),
  );
}
