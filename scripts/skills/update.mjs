import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepare, verifySources } from "./prepare.mjs";
import { publish } from "./publish.mjs";

export function command(cwd, file, args) {
  return execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      DISABLE_TELEMETRY: "1",
    },
  }).trim();
}

export function repositoryFromRemote(remote) {
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error(`Expected a GitHub origin; got ${remote}`);
  return match[1];
}

export function renderReport(template, prepared, validation, runUrl) {
  const changed = prepared.changes.map(
    (entry) =>
      `- **${entry.name}** (${entry.source}, \`${entry.skillPath}\`): previous revision ${entry.previousRef ? `\`${entry.previousRef}\`` : "unknown (not recorded)"}; previous hash \`${entry.previousHash}\`; proposed [\`${entry.ref}\`](https://github.com/${entry.source}/commit/${entry.ref}), hash \`${entry.computedHash}\`. Review the complete skill, bundled references, and attribution diff.`,
  );
  const pending = prepared.pending.map(
    (entry) =>
      `- ${entry.name}: ${entry.reason || "upstream candidate requires review before installation"}. Candidate: \`${entry.ref || entry.candidateRef}\`.`,
  );
  const sections = {
    Summary: `- What changed: Prepare updates only for already tracked project skills using Skills CLI ${prepared.cliVersion}.\n- Why: Keep upstream instructions current with manual review and merging.\n\n${changed.join("\n") || "No installed skill changes."}\n\n${pending.length ? `Pending upstream review (not installed):\n${pending.join("\n")}` : "No candidates pending prior review."}\n\nOn a refreshed PR, the latest updater report comment contains the current changes and validation evidence. The initial PR body and maintainer comments are preserved.`,
    "Agent Review Context":
      "- Primary entry points: Changed `.agents/skills/` directories, `skills-lock.json`, and `.agents/licenses/`.\n- Related issue/spec: `docs/skill-updates.md` and `docs/github-issues.md`.\n- Important invariants: Tracked skills only; pinned upstream commits; repository guidance/templates unchanged; github-issues requires prior recorded review and byte/hash/license verification.\n- Out of scope: Application changes, new skills, global skills, automatic merging.\n- Known limitations or follow-ups: Tests cannot approve instruction quality. Review every source diff and pending candidate before merging.",
    "Change Surface":
      "- Public APIs/routes/types: None.\n- Data model or migrations: None.\n- Auth/security/privacy: Skills are instructions and may change tool invocation; review those boundaries.\n- UI/UX/accessibility: None.\n- Observability/errors: Exact validation results below.\n- Dependencies/config/env: Vendored skills, associated lock metadata, and attribution only.",
    "Validation Evidence": `${validation.map((item) => `- [x] \`${item.command}\`: ${item.outcome}`).join("\n")}\n- [ ] \`task verify:all\`: Not run; no application or browser behavior changes.\n- [ ] Manual validation: Maintainer review of source/instruction/license changes required.\n- Not run / partial validation reason: Pending-review github-issues candidates are not installed.\n${runUrl ? `\n[Updater workflow logs](${runUrl}) contain the validation run; these checks run before publication and do not depend on a PR event.` : "\nLocal isolated check; no live GitHub publication was performed."}`,
    "AI Authorship Note":
      "- Authoring agent/tool: Deterministic repository skill updater and pinned Skills CLI.\n- Prompt/spec source: Tracked source manifest and repository maintenance contracts.\n- Human-reviewed before PR: Only revisions explicitly recorded in `.github/skills-review.json`; remaining proposed changes require review.\n- Files intentionally not changed: `AGENTS.md`, issue/PR templates, application files, and untracked skills.\n- Areas where reviewers should distrust this description and inspect the code directly: Changed upstream instructions, full bundled references, source identity, licensing, and unknown previous revisions.",
  };
  // Fail closed when the repository adds a new heading needing a report entry.
  return template.replace(
    /^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
    (section, heading) => {
      if (heading === "Review Guide") return section;
      if (!(heading in sections))
        throw new Error(
          `Add report content for PR template heading: ${heading}`,
        );
      return `## ${heading}\n\n${sections[heading]}\n\n`;
    },
  );
}

export async function validateProposal({
  cwd,
  prepared,
  run = command,
  compare = verifySources,
}) {
  const validation = [];
  for (const args of [
    ["exec", "--", "task", "verify"],
    ["exec", "--", "task", "hooks:run"],
  ]) {
    console.log(`Running mise ${args.join(" ")}`);
    const output = run(cwd, "mise", args);
    if (output) console.log(output);
    validation.push({ command: `mise ${args.join(" ")}`, outcome: "passed" });
  }
  await compare({ cwd, prepared });
  validation.push({
    command: "verifySources (after hooks)",
    outcome:
      "installed file lists, bytes, lock hashes and attribution match fetched source snapshots, including github-issues",
  });
  return validation;
}

export async function runUpdate({
  cwd,
  shouldPublish = false,
  outputDir,
  run = command,
  prepareSkills = prepare,
  validate = validateProposal,
  publishChanges = publish,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
}) {
  const output = outputDir || mkdtempSync(join(tmpdir(), "nexa-skill-update-"));
  mkdirSync(output, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "nexa-skill-sources-"));
  const checkout = join(scratch, "checkout");
  const result = { status: "failed", output, checkout };
  try {
    if (run(cwd, "git", ["status", "--porcelain", "--untracked-files=no"]))
      throw new Error(
        "Commit tracked local changes before an isolated skill update check.",
      );
    const remote = run(cwd, "git", ["remote", "get-url", "origin"]);
    const repository = repositoryFromRemote(remote);
    if (
      process.env.GITHUB_REPOSITORY &&
      process.env.GITHUB_REPOSITORY !== repository
    )
      throw new Error(
        "GITHUB_REPOSITORY does not match the origin repository.",
      );
    if (shouldPublish && process.env.GITHUB_ACTIONS !== "true")
      throw new Error(
        "Use workflow_dispatch to publish. Local checks never publish; see docs/skill-updates.md.",
      );
    const baseSha = run(cwd, "git", ["rev-parse", "HEAD"]);
    run(cwd, "git", [
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--no-checkout",
      cwd,
      checkout,
    ]);
    run(checkout, "git", ["checkout", "--detach", baseSha]);
    run(checkout, "git", ["remote", "set-url", "origin", remote]);
    run(checkout, "mise", ["trust", "--yes"]);
    const prepared = await prepareSkills({
      cwd: checkout,
      scratch: join(scratch, "preparation"),
    });
    result.prepared = prepared;
    writeFileSync(
      join(output, "proposal.json"),
      `${JSON.stringify(prepared, null, 2)}\n`,
    );
    if (!prepared.changes.length) {
      result.status = prepared.pending.length ? "pending-review" : "no-change";
      return result;
    }
    run(checkout, "mise", [
      "exec",
      "--",
      "bun",
      "install",
      "--frozen-lockfile",
    ]);
    // Include new bundled files in all-files hooks, without exposing other paths.
    run(checkout, "git", [
      "add",
      "--",
      ".agents/skills",
      ".agents/licenses",
      "skills-lock.json",
    ]);
    const validation = await validate({ cwd: checkout, prepared, run });
    result.validation = validation;
    const paths = [
      run(checkout, "git", ["diff", "HEAD", "--name-only", "-z"]),
      run(checkout, "git", [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ]
      .join("\0")
      .split("\0")
      .filter(Boolean);
    const changedNames = new Set(prepared.changes.map((entry) => entry.name));
    const licenseTargets = new Set(
      (prepared.verified || []).flatMap((entry) =>
        entry.licenses.map((license) => license.target),
      ),
    );
    for (const path of paths) {
      if (path === "skills-lock.json" || licenseTargets.has(path)) continue;
      if (
        path.startsWith(".agents/skills/") &&
        changedNames.has(path.split("/")[2])
      )
        continue;
      throw new Error(
        `Validation modified a protected/unselected file: ${path}`,
      );
    }
    const runUrl = process.env.GITHUB_RUN_ID
      ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
    const body = renderReport(
      readFileSync(join(checkout, ".github/pull_request_template.md"), "utf8"),
      prepared,
      validation,
      runUrl,
    );
    const bodyPath = join(output, "pull-request.md");
    writeFileSync(bodyPath, body);
    if (shouldPublish) {
      const base = run(checkout, "gh", [
        "repo",
        "view",
        repository,
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ]);
      if (process.env.GITHUB_REF !== `refs/heads/${base}`)
        throw new Error(
          "Publishing is allowed only from the repository default branch.",
        );
      run(checkout, "git", [
        "add",
        "--",
        ".agents/skills",
        ".agents/licenses",
        "skills-lock.json",
      ]);
      run(checkout, "git", [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "Update tracked project skills",
      ]);
      result.publication = publishChanges({
        cwd: checkout,
        repository,
        base,
        baseSha,
        bodyPath,
      });
      if (result.publication.head) {
        run(checkout, "gh", [
          "api",
          `repos/${repository}/statuses/${result.publication.head}`,
          "-X",
          "POST",
          "-f",
          "state=success",
          "-f",
          "context=Skill updates / validation",
          "-f",
          "description=task verify, hooks, and upstream byte checks passed",
          "-f",
          `target_url=${runUrl}`,
        ]);
      }
    }
    result.status = shouldPublish
      ? result.publication.status
      : "validated-local-proposal";
    return result;
  } catch (error) {
    result.error = error.message;
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    throw error;
  } finally {
    writeFileSync(
      join(output, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const summary = `Skill update result: **${result.status}**${result.error ? `\n\n${result.error}` : ""}\n\n${result.prepared?.pending?.length ? `Candidates pending prior review: ${JSON.stringify(result.prepared.pending)}\n\n` : ""}Report directory: ${output}\n`;
    console.log(summary);
    if (summaryPath) appendFileSync(summaryPath, summary);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    process.argv.length !== 3 ||
    !["--check", "--publish"].includes(process.argv[2])
  ) {
    console.error(
      "Usage: mise exec -- bun scripts/skills/update.mjs --check|--publish",
    );
    process.exitCode = 1;
  } else {
    await runUpdate({
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
      shouldPublish: process.argv[2] === "--publish",
      outputDir: process.env.SKILL_UPDATE_OUTPUT,
    }).catch((error) => {
      console.error(`Skill update failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
