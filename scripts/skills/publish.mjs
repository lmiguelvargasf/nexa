import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = "<!-- project-skill-updater:v1 -->";
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const SHA = /^[a-f0-9]{40}$/;

function defaultRun(command, args, options) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function message(tree, base, report) {
  return `chore: update project skills\n\nSkill-Updater: 1\nSkill-Updater-Tree: ${tree}\nSkill-Updater-Base: ${base}\nSkill-Updater-Report: ${report}\n`;
}

function fail(reason) {
  throw new Error(`Skill update publication stopped: ${reason}`);
}

function headMarker(head) {
  return `<!-- project-skill-updater-head:${head} -->`;
}

/**
 * Publish a validated, clean, single-commit candidate without changing its checkout.
 * A lease protects branch updates. Existing PR text is never edited: new reports
 * are additive comments so concurrent maintainer edits cannot be overwritten.
 * The injected runner is used by fixtures; production executes argument arrays.
 */
export function publish({
  cwd,
  repository,
  base,
  baseSha,
  bodyPath,
  branch = "automation/skill-updates",
  expectedHead = "HEAD",
  run = defaultRun,
}) {
  const env = { ...process.env, GH_REPO: "" };
  const command = (name, args, extra = {}) => {
    try {
      return run(name, args, { cwd, env, ...extra }).trim();
    } catch (error) {
      const detail = String(error.stderr || error.message).trim();
      throw new Error(
        `${name} ${args.slice(0, 3).join(" ")} failed: ${detail}`,
        {
          cause: error,
        },
      );
    }
  };
  const git = (...args) => command("git", args);
  const gh = (...args) => command("gh", args);
  const json = (...args) => JSON.parse(gh(...args));
  const reportFor = (pr, head) => {
    if (pr.body.includes(headMarker(head))) return true;
    const pages = json(
      "api",
      `repos/${repository}/issues/${pr.number}/comments`,
      "--paginate",
      "--slurp",
    );
    return pages
      .flat()
      .some((comment) => comment.body.includes(headMarker(head)));
  };
  const postReport = (pr, head, report, temp) => {
    if (reportFor(pr, head)) return;
    const commentPath = join(temp, "report.md");
    writeFileSync(
      commentPath,
      `## Skill update validation report\n\nCommit: ${head}\n\n${report}\n\n${headMarker(head)}\n`,
    );
    try {
      gh(
        "pr",
        "comment",
        String(pr.number),
        "--repo",
        repository,
        "--body-file",
        commentPath,
      );
    } catch (error) {
      if (!reportFor(pr, head)) {
        fail(
          `the branch updated but its validation-report comment failed; rerun to recover the report without creating another PR. ${error.message}`,
        );
      }
    }
    if (!reportFor(pr, head))
      fail(
        "the validation-report comment could not be verified; inspect the existing PR and rerun.",
      );
  };

  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    fail("repository must be the current OWNER/REPO.");
  }
  if (!SHA.test(baseSha)) fail("baseSha must be a full, verified commit SHA.");
  git("check-ref-format", "--branch", branch);
  git("check-ref-format", "--branch", base);
  if (branch === base)
    fail("the update branch must not be the default branch.");
  if (git("status", "--porcelain")) {
    fail(
      "the validated candidate checkout is dirty; commit only reviewed update files first.",
    );
  }
  const candidate = git("rev-parse", "--verify", `${expectedHead}^{commit}`);
  const tree = git("rev-parse", `${candidate}^{tree}`);
  if (tree === git("rev-parse", `${baseSha}^{tree}`)) {
    return { status: "no-change" };
  }
  if (git("show", "-s", "--format=%P", candidate) !== baseSha) {
    fail(
      "the candidate must be a single commit directly on the verified default-branch base.",
    );
  }

  // Clearing GH_REPO prevents an environment override from changing the destination.
  // Resolve origin explicitly as well: gh's configured default may point upstream.
  for (const args of [
    ["remote", "get-url", "origin"],
    ["remote", "get-url", "--push", "--all", "origin"],
  ]) {
    const match = git(...args).match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
    if (!match || match[1].toLowerCase() !== repository.toLowerCase()) {
      fail(
        "origin does not match the requested GitHub repository; verify both fetch and push URLs in the running clone.",
      );
    }
  }
  const repo = json(
    "repo",
    "view",
    repository,
    "--json",
    "nameWithOwner,defaultBranchRef",
  );
  if (
    repo.nameWithOwner.toLowerCase() !== repository.toLowerCase() ||
    repo.defaultBranchRef.name !== base
  ) {
    fail(
      "repository identity or default branch changed; prepare a fresh candidate.",
    );
  }
  const remoteHead = (ref) => {
    const result = git("ls-remote", "--heads", "origin", `refs/heads/${ref}`);
    return result ? result.split(/\s+/)[0] : "";
  };
  if (remoteHead(base) !== baseSha) {
    fail(
      "the default branch advanced during validation; rerun from its current head.",
    );
  }

  const list = () =>
    json(
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "all",
      "--head",
      branch,
      "--limit",
      "100",
      "--json",
      "number,url,state,baseRefName,headRefName,headRefOid,isCrossRepository,body,isDraft",
    );
  const select = (pulls) => {
    const open = pulls.filter((pr) => pr.state === "OPEN");
    if (open.length > 1)
      fail("multiple open update PRs exist; reconcile them manually.");
    const pr = open[0];
    if (
      pr &&
      (pr.baseRefName !== base ||
        pr.headRefName !== branch ||
        pr.isCrossRepository ||
        pr.isDraft ||
        !pr.body.includes(MARKER))
    ) {
      fail(
        "the existing PR is not an owned, ready-for-review update PR; preserve it and reconcile manually.",
      );
    }
    return pr;
  };
  const pulls = list();
  let pr = select(pulls);
  let previous = remoteHead(branch);
  if (pr && !previous)
    fail("the existing PR has no branch; restore it or close it manually.");
  if (!pr && previous && pulls.some((item) => item.state === "CLOSED")) {
    fail(
      "a maintainer closed an update PR; delete its automation branch to explicitly allow a new PR.",
    );
  }
  let owned;
  if (previous) {
    git("fetch", "--no-tags", "origin", `refs/heads/${branch}`);
    if (git("rev-parse", "FETCH_HEAD") !== previous) {
      fail(
        "the update branch changed while inspecting it; rerun after the other writer finishes.",
      );
    }
    const [
      body,
      remoteTree,
      parents,
      author,
      email,
      committer,
      committerEmail,
    ] = git(
      "show",
      "-s",
      "--format=%B%x00%T%x00%P%x00%an%x00%ae%x00%cn%x00%ce",
      previous,
    ).split("\0");
    const report = body.match(/^Skill-Updater-Report: ([a-f0-9]{64})$/m)?.[1];
    if (
      !SHA.test(parents) ||
      !report ||
      body.trim() !== message(remoteTree, parents, report).trim() ||
      author !== BOT_NAME ||
      email !== BOT_EMAIL ||
      committer !== BOT_NAME ||
      committerEmail !== BOT_EMAIL
    ) {
      fail(
        "the update branch contains maintainer edits or an unrecognized commit; preserve it and reconcile manually.",
      );
    }
    owned = { tree: remoteTree, base: parents };
    if (pr && pr.headRefOid !== previous) {
      fail(
        "the PR head and remote branch disagree; rerun after the in-flight update finishes.",
      );
    }
  }
  if (pr && owned.tree === tree && owned.base === baseSha) {
    // Recover a previous run whose push succeeded but report publication failed.
    const temp = mkdtempSync(join(tmpdir(), "skill-publication-"));
    try {
      postReport(pr, previous, readFileSync(bodyPath, "utf8").trimEnd(), temp);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    return { status: "unchanged", url: pr.url, head: previous };
  }

  const report = readFileSync(bodyPath, "utf8").trimEnd();
  const reportHash = createHash("sha256").update(report).digest("hex");
  const temp = mkdtempSync(join(tmpdir(), "skill-publication-"));
  try {
    const commitPath = join(temp, "commit.txt");
    writeFileSync(commitPath, message(tree, baseSha, reportHash));
    const head = command(
      "git",
      ["commit-tree", tree, "-p", baseSha, "-F", commitPath],
      {
        env: {
          ...env,
          GIT_AUTHOR_NAME: BOT_NAME,
          GIT_AUTHOR_EMAIL: BOT_EMAIL,
          GIT_COMMITTER_NAME: BOT_NAME,
          GIT_COMMITTER_EMAIL: BOT_EMAIL,
        },
      },
    );
    // Re-read PR state immediately before publishing. No PR body/title edit is ever issued.
    const current = select(list());
    if ((pr?.number ?? null) !== (current?.number ?? null)) {
      fail(
        "the update PR changed during preparation; rerun before publishing.",
      );
    }
    if (remoteHead(base) !== baseSha) {
      fail(
        "the default branch advanced during publication; rerun validation on the new base.",
      );
    }
    try {
      git(
        "push",
        `--force-with-lease=refs/heads/${branch}:${previous}`,
        "origin",
        `${head}:refs/heads/${branch}`,
      );
    } catch (error) {
      fail(
        `the branch push failed (permissions or a concurrent branch edit). No lease is retried automatically. ${error.message}`,
      );
    }
    previous = head;

    const initialBody = `${report}\n\n${MARKER}\n${headMarker(head)}\n\nThis PR is maintained by the project skill updater. Its title and description are preserved after creation. For subsequent updates, the latest **Skill update validation report** comment contains the current source changes and validation evidence. Review skill instructions and merge manually.\n`;
    const publishedBody = join(temp, "body.md");
    writeFileSync(publishedBody, initialBody);
    const created = !pr;
    if (!pr) {
      try {
        gh(
          "pr",
          "create",
          "--repo",
          repository,
          "--head",
          branch,
          "--base",
          base,
          "--title",
          "chore: update project skills",
          "--body-file",
          publishedBody,
        );
      } catch (error) {
        // A failed response can follow a successful create. Read before retrying.
        pr = select(list());
        if (!pr) {
          fail(
            `the branch was published but PR creation failed. Enable Actions pull-request creation and contents/pull-requests write permissions, then rerun; the owned branch will be reused. ${error.message}`,
          );
        }
      }
      pr ??= select(list());
      if (!pr)
        fail(
          "PR creation returned without a discoverable PR; inspect the branch before rerunning.",
        );
    }
    const verified = json(
      "pr",
      "view",
      String(pr.number),
      "--repo",
      repository,
      "--json",
      "number,url,state,baseRefName,headRefName,headRefOid,isCrossRepository,body,isDraft",
    );
    select([verified]);
    if (
      verified.state !== "OPEN" ||
      verified.headRefOid !== head ||
      remoteHead(branch) !== head
    ) {
      fail(
        "published PR/branch verification failed; inspect the existing PR before rerunning.",
      );
    }
    if (created && verified.body !== initialBody) {
      fail(
        "the created PR body differs from the generated report; preserved it for manual review.",
      );
    }
    if (!created) {
      postReport(verified, head, report, temp);
    }
    return { status: created ? "created" : "updated", url: verified.url, head };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
