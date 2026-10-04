import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publish } from "./publish.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "skill-publisher-test-"));
  const cwd = join(root, "work");
  const bare = join(root, "remote.git");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const execute = (args, options = {}) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test Maintainer",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test Maintainer",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      ...options,
    }).trim();
  execute(["init", "--bare", bare], { cwd: root });
  execute(["init", "--initial-branch=main", cwd], { cwd: root });
  execute(["config", "core.hooksPath", "/dev/null"]);
  writeFileSync(join(cwd, "skill.txt"), "original\n");
  execute(["add", "skill.txt"]);
  execute(["commit", "-m", "base"]);
  const baseSha = execute(["rev-parse", "HEAD"]);
  execute(["remote", "add", "origin", bare]);
  execute(["push", "origin", "HEAD:refs/heads/main"]);
  const bodyPath = join(root, "report.md");
  writeFileSync(
    bodyPath,
    "## Summary\n\nUpdated the skill.\n\n## Validation Evidence\n\n- `task verify`: passed\n",
  );
  const state = {
    pulls: [],
    comments: [],
    calls: [],
    createFailure: false,
    commentFailure: false,
  };
  const remote = (ref = "automation/skill-updates") => {
    const result = execute(["ls-remote", "origin", `refs/heads/${ref}`]);
    return result ? result.split(/\s+/)[0] : "";
  };
  const runner = (name, args, options) => {
    state.calls.push([name, ...args]);
    if (name === "git") {
      if (args[0] === "remote" && args[1] === "get-url") {
        if (args.includes("--push") && state.pushOrigin)
          return state.pushOrigin;
        return (
          state.origin ?? "https://github.com/fixture-owner/copied-project.git"
        );
      }
      if (args[0] === "push" && state.beforePush) {
        const before = state.beforePush;
        state.beforePush = undefined;
        before();
      }
      return execute(args, {
        ...options,
        env: {
          ...options.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      });
    }
    assert.equal(name, "gh");
    const value = (flag) => args[args.indexOf(flag) + 1];
    const refresh = () =>
      state.pulls.map((pr) => ({ ...pr, headRefOid: remote() }));
    if (args[0] === "repo") {
      return JSON.stringify({
        nameWithOwner: "fixture-owner/copied-project",
        defaultBranchRef: { name: "main" },
      });
    }
    if (args[0] === "api") {
      assert.match(
        args[1],
        /^repos\/fixture-owner\/copied-project\/issues\/1\/comments$/,
      );
      return JSON.stringify([state.comments]);
    }
    if (args[1] === "list") return JSON.stringify(refresh());
    if (args[1] === "view") return JSON.stringify(refresh()[0]);
    if (args[1] === "create") {
      if (state.createFailure === "before")
        throw new Error("pull request permission denied");
      assert.equal(value("--repo"), "fixture-owner/copied-project");
      assert.equal(value("--base"), "main");
      assert.equal(state.pulls.length, 0, "must reuse the existing PR");
      state.pulls.push({
        number: 1,
        url: "https://github.com/fixture-owner/copied-project/pull/1",
        state: "OPEN",
        baseRefName: "main",
        headRefName: value("--head"),
        isCrossRepository: false,
        isDraft: false,
        body: readFileSync(value("--body-file"), "utf8"),
        title: value("--title"),
      });
      if (state.createFailure)
        throw new Error("connection lost after creation");
      return state.pulls[0].url;
    }
    if (args[1] === "comment") {
      if (state.commentFailure) throw new Error("comments permission denied");
      state.comments.push({ body: readFileSync(value("--body-file"), "utf8") });
      return "comment created";
    }
    assert.fail(`unexpected command: ${name} ${args.join(" ")}`);
  };
  const options = {
    cwd,
    repository: "fixture-owner/copied-project",
    base: "main",
    baseSha,
    bodyPath,
    run: runner,
  };
  const candidate = (content) => {
    execute(["reset", "--hard", baseSha]);
    writeFileSync(join(cwd, "skill.txt"), `${content}\n`);
    execute(["add", "skill.txt"]);
    execute(["commit", "-m", "validated update"]);
  };
  const editRemote = (message = "Maintainer edit") => {
    const commitPath = join(root, "manual-message.txt");
    writeFileSync(commitPath, message);
    const head = execute([
      "commit-tree",
      `${baseSha}^{tree}`,
      "-p",
      remote(),
      "-F",
      commitPath,
    ]);
    execute([
      "push",
      "--force",
      "origin",
      `${head}:refs/heads/automation/skill-updates`,
    ]);
    return head;
  };
  return {
    state,
    execute,
    options,
    candidate,
    remote,
    editRemote,
    root,
    cwd,
    bare,
    baseSha,
  };
}

test("a no-change run does not contact GitHub or create a branch", (t) => {
  const f = fixture(t);
  assert.deepEqual(publish(f.options), { status: "no-change" });
  assert.equal(f.remote(), "");
  assert.equal(
    f.state.calls.some(([name]) => name === "gh"),
    false,
  );
});

test("changed and repeated runs maintain one regular PR and preserve the default branch", (t) => {
  const f = fixture(t);
  f.candidate("updated");
  const localHead = f.execute(["rev-parse", "HEAD"]);
  const first = publish(f.options);
  assert.equal(first.status, "created");
  assert.equal(f.remote(), first.head);
  assert.equal(f.remote("main"), f.baseSha);
  assert.equal(f.execute(["rev-parse", "HEAD"]), localHead);
  assert.match(
    f.state.pulls[0].body,
    /latest \*\*Skill update validation report\*\* comment/,
  );
  assert.equal(publish(f.options).status, "unchanged");
  assert.equal(f.state.pulls.length, 1);
  assert.equal(f.state.comments.length, 0);
  assert.equal(
    f.state.calls.filter((call) => call[0] === "git" && call[1] === "push")
      .length,
    1,
  );
});

test("refresh appends one verified report while preserving maintainer title and body edits", (t) => {
  const f = fixture(t);
  f.candidate("first");
  publish(f.options);
  f.state.pulls[0].body += "\nMaintainer review notes that must survive.\n";
  f.state.pulls[0].title = "Maintainer's title";
  const body = f.state.pulls[0].body;
  f.candidate("second");
  const result = publish(f.options);
  assert.equal(result.status, "updated");
  assert.equal(f.state.pulls[0].body, body);
  assert.equal(f.state.pulls[0].title, "Maintainer's title");
  assert.equal(f.state.comments.length, 1);
  assert.match(f.state.comments[0].body, new RegExp(result.head));
  assert.equal(publish(f.options).status, "unchanged");
  assert.equal(f.state.comments.length, 1);
});

test("manual branch commits stop publication without changing the remote", (t) => {
  const f = fixture(t);
  f.candidate("first");
  publish(f.options);
  const manual = f.editRemote();
  f.candidate("second");
  assert.throws(() => publish(f.options), /maintainer edits/);
  assert.equal(f.remote(), manual);
  assert.equal(f.state.comments.length, 0);
});

test("amending generated content while retaining its trailers is detected", (t) => {
  const f = fixture(t);
  f.candidate("first");
  publish(f.options);
  const old = f.remote();
  const messagePath = join(f.root, "amended.txt");
  writeFileSync(messagePath, f.execute(["show", "-s", "--format=%B", old]));
  const amended = f.execute(
    ["commit-tree", `${f.baseSha}^{tree}`, "-p", f.baseSha, "-F", messagePath],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "github-actions[bot]",
        GIT_AUTHOR_EMAIL:
          "41898282+github-actions[bot]@users.noreply.github.com",
        GIT_COMMITTER_NAME: "github-actions[bot]",
        GIT_COMMITTER_EMAIL:
          "41898282+github-actions[bot]@users.noreply.github.com",
      },
    },
  );
  f.execute([
    "push",
    "--force",
    "origin",
    `${amended}:refs/heads/automation/skill-updates`,
  ]);
  f.candidate("second");
  assert.throws(() => publish(f.options), /maintainer edits/);
  assert.equal(f.remote(), amended);
});

test("lease rejects a concurrent branch writer and never retries the push", (t) => {
  const f = fixture(t);
  f.candidate("first");
  publish(f.options);
  f.candidate("second");
  let concurrent;
  f.state.beforePush = () => {
    concurrent = f.editRemote("Concurrent maintainer edit");
  };
  assert.throws(() => publish(f.options), /concurrent branch edit/);
  assert.equal(f.remote(), concurrent);
  assert.equal(
    f.state.calls.filter((call) => call[0] === "git" && call[1] === "push")
      .length,
    2,
  );
});

test("uncertain PR creation is read back and reused instead of duplicated", (t) => {
  const f = fixture(t);
  f.candidate("first");
  f.state.createFailure = true;
  assert.equal(publish(f.options).status, "created");
  assert.equal(f.state.pulls.length, 1);
  assert.equal(publish(f.options).status, "unchanged");
});

test("denied PR creation fails and its owned branch is reused after permissions are fixed", (t) => {
  const f = fixture(t);
  f.candidate("first");
  f.state.createFailure = "before";
  assert.throws(
    () => publish(f.options),
    /Enable Actions pull-request creation/,
  );
  assert.notEqual(f.remote(), "");
  assert.equal(f.state.pulls.length, 0);
  f.state.createFailure = false;
  assert.equal(publish(f.options).status, "created");
  assert.equal(f.state.pulls.length, 1);
});

test("failed report publication fails the run and a repeat recovers the missing report", (t) => {
  const f = fixture(t);
  f.candidate("first");
  publish(f.options);
  f.candidate("second");
  f.state.commentFailure = true;
  assert.throws(() => publish(f.options), /validation-report comment failed/);
  const pushed = f.remote();
  f.state.commentFailure = false;
  assert.equal(publish(f.options).status, "unchanged");
  assert.equal(f.remote(), pushed);
  assert.equal(f.state.comments.length, 1);
  assert.equal(f.state.pulls.length, 1);
});

test("closed PRs, unowned PRs, and repository mismatches are left for maintainers", async (t) => {
  for (const kind of ["closed", "unowned", "repository", "push-repository"]) {
    await t.test(kind, (t) => {
      const f = fixture(t);
      f.candidate("first");
      publish(f.options);
      const previous = f.remote();
      f.candidate("second");
      if (kind === "closed") f.state.pulls[0].state = "CLOSED";
      if (kind === "unowned") f.state.pulls[0].body = "Maintainer PR";
      if (kind === "repository")
        f.state.origin = "https://github.com/another/repository.git";
      if (kind === "push-repository")
        f.state.pushOrigin = "https://github.com/another/repository.git";
      assert.throws(
        () => publish(f.options),
        /closed an update PR|not an owned|origin does not match/,
      );
      assert.equal(f.remote(), previous);
    });
  }
});

test("dirty candidates and attempts to publish onto the default branch fail before remote writes", (t) => {
  const f = fixture(t);
  f.candidate("first");
  assert.throws(
    () => publish({ ...f.options, branch: "main" }),
    /must not be the default branch/,
  );
  writeFileSync(join(f.cwd, "unreviewed.txt"), "unreviewed");
  assert.throws(() => publish(f.options), /checkout is dirty/);
  assert.equal(f.remote(), "");
  assert.equal(f.state.pulls.length, 0);
});

test("default-branch advancement requires validation on a fresh base", (t) => {
  const f = fixture(t);
  f.candidate("updated");
  const newer = f.execute(["rev-parse", "HEAD"]);
  f.execute(["push", "origin", `${newer}:refs/heads/main`]);
  assert.throws(() => publish(f.options), /default branch advanced/);
  assert.equal(f.remote(), "");
  assert.equal(f.state.pulls.length, 0);
});
