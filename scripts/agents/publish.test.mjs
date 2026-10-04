import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  githubRequest,
  makeJwt,
  publish,
  readProtectedConfig,
  repositoryFromUrl,
  validateReport,
} from "./publish.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const key = privateKey.export({ type: "pkcs1", format: "pem" });
const head = "a".repeat(40);
const baseSha = "b".repeat(40);
const oldHead = "c".repeat(40);
const template = readFileSync(
  new URL("../../.github/pull_request_template.md", import.meta.url),
  "utf8",
);
const report = template
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(
    /^(## .+)$/gm,
    "$1\n\nImplemented #58; `mise exec -- task verify` passed.",
  );

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "publisher-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bodyPath = join(root, "report.md");
  writeFileSync(bodyPath, report);
  const config = {
    appId: 123,
    clientId: "Iv123",
    installationId: 456,
    botId: 789,
    slug: "briko",
    repository: "owner/repo",
    ghPath: "/trusted/gh",
    key,
  };
  const state = {
    branch: "issue/58-briko",
    remote: "git@github.com:owner/repo.git",
    pushRemote: null,
    dirty: "",
    previous: "",
    base: baseSha,
    pulls: [],
    commands: [],
    requests: [],
    comments: [],
    workflows: false,
    createFails: false,
    createSucceedsThenFails: false,
    pushFails: false,
    tokenPatch: {},
    appPatch: {},
    installationPatch: {},
    botPatch: {},
    ...overrides,
  };
  const pull = (body = `${report}\n<!-- agent-publisher:v1 issue:58 -->`) => ({
    number: 60,
    html_url: "https://github.com/owner/repo/pull/60",
    state: "open",
    draft: false,
    title: "Implement Briko",
    user: { id: 789, login: "briko[bot]", type: "Bot" },
    body,
    base: { ref: "main", repo: { full_name: "owner/repo" } },
    head: {
      ref: state.branch,
      sha: state.previous || state.localHead || head,
      repo: { full_name: "owner/repo" },
    },
  });
  const run = (command, args, options) => {
    state.commands.push({ command, args, options });
    if (command === "/trusted/gh") {
      if (args[1] === "create") {
        if (state.createFails) throw new Error("do not print token: sensitive");
        const pr = pull(
          readFileSync(args[args.indexOf("--body-file") + 1], "utf8"),
        );
        pr.draft = args.includes("--draft");
        state.pulls = [pr];
        if (state.createSucceedsThenFails) throw new Error("lost response");
      }
      if (args[1] === "comment")
        state.comments.push({
          user: { id: 789 },
          body: readFileSync(args[args.indexOf("--body-file") + 1], "utf8"),
        });
      if (args[1] === "ready") state.pulls[0].draft = false;
      return "";
    }
    if (args.includes("push")) {
      if (state.pushFails)
        throw new Error("concurrent push failure with token");
      state.previous = state.localHead || head;
      for (const pr of state.pulls) pr.head.sha = state.previous;
      return "";
    }
    if (options.cwd !== root) return ""; // isolated export repository
    const git = args.slice(2);
    if (git[0] === "symbolic-ref") return state.branch;
    if (git[0] === "status") return state.dirty;
    if (git[0] === "remote")
      return git.includes("--push")
        ? (state.pushRemote ?? state.remote)
        : state.remote;
    if (git[0] === "rev-parse") return git[1] === "HEAD" ? head : baseSha;
    if (git[0] === "diff")
      return state.workflows ? ".github/workflows/ci.yml" : "";
    if (git[0] === "show") return template;
    if (git[0] === "merge-base" && state.notAncestor)
      throw new Error("not ancestor");
    return "";
  };
  const request = async (path, token, options = {}) => {
    state.requests.push({ path, token, options });
    if (path === "/app")
      return {
        id: 123,
        client_id: "Iv123",
        slug: "briko",
        permissions: { contents: "write", pull_requests: "write" },
        ...state.appPatch,
      };
    if (path.endsWith("/installation") && path !== "/installation/token")
      return {
        id: 456,
        app_id: 123,
        repository_selection: "selected",
        account: { login: "owner" },
        suspended_at: null,
        permissions: {
          contents: "write",
          pull_requests: "write",
          workflows: "write",
        },
        ...state.installationPatch,
      };
    if (path.endsWith("/access_tokens"))
      return {
        token: "sensitive-installation-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        repositories: [{ full_name: "owner/repo" }],
        permissions: options.body.permissions,
        ...state.tokenPatch,
      };
    if (path === "/installation/token") return null;
    if (path.startsWith("/users/"))
      return { id: 789, login: "briko[bot]", type: "Bot", ...state.botPatch };
    if (path === "/repos/owner/repo") return { full_name: "owner/repo" };
    if (path.includes("/git/ref/heads/")) {
      const sha = path.endsWith("/main") ? state.base : state.previous;
      return sha ? { object: { sha } } : null;
    }
    if (path.includes("/pulls?")) return state.pulls;
    if (path.includes("/comments?")) return state.comments;
    if (path === "/repos/owner/repo/pulls/60") return state.pulls[0];
    if (path.includes("/issues/")) return {};
    throw new Error(`Unhandled fixture path ${path}`);
  };
  return {
    root,
    bodyPath,
    run,
    request,
    state,
    config,
    pull,
    publish: () =>
      publish({
        cwd: root,
        config,
        issue: 58,
        title: "Implement Briko",
        bodyPath,
        run,
        request,
      }),
  };
}

test("destination parsing accepts common clone URLs, rejects credentials, rewrites and multiple destinations", () => {
  for (const url of [
    "git@github.com:owner/repo.git",
    "https://github.com/owner/repo",
    "ssh://git@github.com/owner/repo.git",
  ])
    assert.equal(repositoryFromUrl(url), "owner/repo");
  for (const url of [
    "https://token@github.com/owner/repo",
    "https://evil.test/owner/repo",
    "git@github.com:owner/repo.git\ngit@github.com:other/repo.git",
    "https://github.com/owner/..",
  ])
    assert.throws(() => repositoryFromUrl(url));
});

test("JWT signature, issuer and validity satisfy GitHub App authentication", () => {
  const jwt = makeJwt("Iv123", key, 1700000000000);
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "RS256",
    typ: "JWT",
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), {
    iss: "Iv123",
    iat: 1699999940,
    exp: 1700000540,
  });
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  );
});

test("real Git export preserves commit authorship and excludes checkout hooks/configuration from the token-bearing push", async (t) => {
  const f = fixture(t);
  const git = (...args) =>
    execFileSync("/usr/bin/git", args, {
      cwd: f.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Original Agent",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Original Maintainer",
        GIT_COMMITTER_EMAIL: "committer@example.test",
      },
    }).trim();
  git("init", "--initial-branch=main");
  mkdirSync(join(f.root, ".github"));
  writeFileSync(join(f.root, ".github", "pull_request_template.md"), template);
  git("add", ".github");
  git("commit", "-m", "base");
  f.state.base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", f.state.base);
  git("switch", "-c", "issue/58-briko");
  writeFileSync(join(f.root, "implementation.txt"), "reviewed implementation");
  git("add", ".");
  git(
    "commit",
    "-m",
    "implementation\n\nCo-authored-by: Collaborator <collaborator@example.test>",
  );
  f.state.localHead = git("rev-parse", "HEAD");
  git("remote", "add", "origin", "git@github.com:owner/repo.git");
  const hookMarker = join(f.root, "hook-ran");
  writeFileSync(
    join(f.root, ".git", "hooks", "pre-push"),
    `#!/bin/sh\ntouch '${hookMarker}'\n`,
    { mode: 0o700 },
  );
  git("config", "credential.helper", "!false");
  git("config", "url.https://evil.test/.insteadOf", "https://github.com/");
  let pushed = false;
  const run = (command, args, options) => {
    if (command === f.config.ghPath) return f.run(command, args, options);
    if (args.includes("push")) {
      pushed = true;
      assert.notEqual(options.cwd, f.root);
      const bare = args[args.indexOf("--git-dir") + 1];
      const show = execFileSync(
        "/usr/bin/git",
        [
          "--git-dir",
          bare,
          "show",
          "-s",
          "--format=%an%x00%ae%x00%cn%x00%ce%x00%B",
          f.state.localHead,
        ],
        { ...options, encoding: "utf8" },
      );
      assert.ok(
        show.includes(
          "Original Agent\0author@example.test\0Original Maintainer\0committer@example.test",
        ),
      );
      assert.ok(show.includes("Co-authored-by: Collaborator"));
      const configText = readFileSync(join(bare, "config"), "utf8");
      assert.ok(
        !configText.includes("evil.test") &&
          !configText.includes("sensitive-installation-token"),
      );
      assert.ok(
        !readFileSync(options.env.GIT_ASKPASS, "utf8").includes(
          "sensitive-installation-token",
        ),
      );
      return f.run(command, args, options);
    }
    assert.ok(!options.env.GH_TOKEN && !options.env.BRIKO_PUSH_TOKEN);
    return execFileSync(command, args, {
      ...options,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
  const result = await publish({
    cwd: f.root,
    config: f.config,
    issue: 58,
    title: "Implement Briko",
    bodyPath: f.bodyPath,
    run,
    request: f.request,
  });
  assert.equal(result.head, f.state.localHead);
  assert.ok(pushed);
  assert.ok(!existsSync(hookMarker));
});

test("requires complete template, issue reference and exact validation command", () => {
  validateReport(report, template, 58);
  assert.throws(
    () =>
      validateReport(
        report.replace("## Change Surface", "## Other"),
        template,
        58,
      ),
    /missing template/,
  );
  assert.throws(
    () => validateReport(report.replaceAll("#58", "#99"), template, 58),
    /reference issue/,
  );
  assert.throws(
    () =>
      validateReport(report.replaceAll("task verify", "checks"), template, 58),
    /exact task verify/,
  );
  assert.throws(() => validateReport(template, template, 58));
});

test("creates a regular bot PR with a scoped token and isolates credential-bearing commands", async (t) => {
  const f = fixture(t);
  const result = await f.publish();
  assert.equal(result.status, "created");
  assert.equal(result.author, "briko[bot]");
  const mint = f.state.requests.find((r) => r.path.endsWith("/access_tokens"));
  assert.deepEqual(mint.options.body, {
    repositories: ["repo"],
    permissions: { contents: "write", pull_requests: "write" },
  });
  assert.equal(f.state.requests.at(-1).path, "/installation/token");
  for (const c of f.state.commands) {
    assert.ok(!c.args.join(" ").includes("sensitive-installation-token"));
    if (c.options.cwd === f.root) {
      assert.ok(!c.options.env.GH_TOKEN);
      assert.ok(!c.options.env.BRIKO_PUSH_TOKEN);
    }
    if (c.args.includes("push")) {
      assert.ok(
        c.args.includes("--force-with-lease=refs/heads/issue/58-briko:"),
      );
      assert.equal(
        c.options.env.BRIKO_PUSH_TOKEN,
        "sensitive-installation-token",
      );
      assert.ok(c.args.includes("core.hooksPath=/dev/null"));
      assert.ok(!c.options.cwd.includes("export.git"));
    }
    if (c.command === "/trusted/gh") {
      assert.equal(c.options.env.GH_TOKEN, "sensitive-installation-token");
      assert.ok(c.options.env.GH_CONFIG_DIR.startsWith(c.options.cwd));
      assert.ok(!c.args.includes("--draft"));
      assert.ok(c.args.includes("--repo") && c.args.includes("owner/repo"));
    }
    assert.equal(c.options.env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.ok(!("NODE_OPTIONS" in c.options.env));
  }
  assert.ok(!f.state.pulls[0].draft);
});

test("adds workflow permission only for workflow changes", async (t) => {
  const f = fixture(t, { workflows: true });
  await f.publish();
  assert.equal(
    f.state.requests.find((r) => r.path.endsWith("/access_tokens")).options.body
      .permissions.workflows,
    "write",
  );
});

test("rerun reuses PR without duplicate creation or report", async (t) => {
  const f = fixture(t);
  await f.publish();
  const result = await f.publish();
  assert.equal(result.status, "reused");
  assert.equal(
    f.state.commands.filter(
      (c) => c.command === "/trusted/gh" && c.args[1] === "create",
    ).length,
    1,
  );
  assert.equal(f.state.comments.length, 0);
});

test("updates ancestor branch, preserves human description edits, reports validation and deduplicates comments", async (t) => {
  const f = fixture(t, { previous: oldHead });
  f.state.pulls = [f.pull()];
  const original = f.state.pulls[0].body;
  const result = await f.publish();
  assert.equal(result.status, "updated");
  assert.equal(f.state.pulls[0].body, original);
  assert.equal(f.state.comments.length, 1);
  await f.publish();
  assert.equal(f.state.comments.length, 1);
});

test("recovers uncertain successful create by inspecting existing PR", async (t) => {
  const f = fixture(t, { createSucceedsThenFails: true });
  assert.equal((await f.publish()).status, "created");
  assert.equal(f.state.pulls.length, 1);
});

test("failed creation leaves branch reusable and revokes token without leaking subprocess error", async (t) => {
  const f = fixture(t, { createFails: true });
  await assert.rejects(f.publish(), /publication command failed/);
  assert.equal(f.state.previous, head);
  assert.equal(f.state.requests.at(-1).path, "/installation/token");
  f.state.createFails = false;
  assert.equal((await f.publish()).status, "created");
});

test("matching draft is made ready on completed publication", async (t) => {
  const f = fixture(t, { previous: head });
  const pr = f.pull();
  pr.draft = true;
  f.state.pulls = [pr];
  await f.publish();
  assert.ok(!pr.draft);
  assert.ok(f.state.commands.some((c) => c.args[1] === "ready"));
});

for (const [name, patch, message] of [
  ["dirty candidate", { dirty: " M README.md" }, /dirty/],
  ["unrelated issue branch", { branch: "issue/99-work" }, /publish from/],
  [
    "mismatched push destination",
    { pushRemote: "git@github.com:other/repo.git" },
    /destination/,
  ],
  ["wrong App identity", { appPatch: { slug: "other" } }, /App identity/],
  [
    "excess App permissions",
    { appPatch: { permissions: { administration: "write" } } },
    /unnecessary permissions/,
  ],
  [
    "all-repository installation",
    { installationPatch: { repository_selection: "all" } },
    /incorrectly scoped/,
  ],
  [
    "suspended installation",
    { installationPatch: { suspended_at: "today" } },
    /suspended/,
  ],
  [
    "missing publication permission",
    { installationPatch: { permissions: { contents: "read" } } },
    /needs contents/,
  ],
  [
    "expired token",
    { tokenPatch: { expires_at: "2000-01-01T00:00:00Z" } },
    /token is expired/,
  ],
  [
    "broad token",
    {
      tokenPatch: {
        repositories: [
          { full_name: "owner/repo" },
          { full_name: "owner/other" },
        ],
      },
    },
    /incorrectly scoped/,
  ],
  [
    "wrong token repository",
    { tokenPatch: { repositories: [{ full_name: "owner/other" }] } },
    /incorrectly scoped/,
  ],
  ["wrong bot identity", { botPatch: { id: 999 } }, /bot ID/],
  ["advanced base", { base: oldHead }, /base advanced/],
  ["unowned remote branch", { previous: oldHead }, /without a matching/],
  ["push conflict", { pushFails: true }, /publication command failed/],
])
  test(`fails closed: ${name}`, async (t) => {
    const f = fixture(t, patch);
    await assert.rejects(f.publish(), message);
    if (f.state.requests.some((r) => r.path.endsWith("/access_tokens")))
      assert.equal(f.state.requests.at(-1).path, "/installation/token");
    assert.equal(f.state.pulls.length, 0);
  });

for (const [name, mutate] of [
  [
    "human-authored PR",
    (pr) => {
      pr.user = { id: 999, login: "owner", type: "User" };
    },
  ],
  [
    "wrong issue",
    (pr) => {
      pr.body = "<!-- agent-publisher:v1 issue:99 --> #99";
    },
  ],
  [
    "cross-repository PR",
    (pr) => {
      pr.head.repo.full_name = "other/repo";
    },
  ],
  [
    "closed PR",
    (pr) => {
      pr.state = "closed";
    },
  ],
])
  test(`preserves existing ${name}`, async (t) => {
    const f = fixture(t, { previous: oldHead });
    const pr = f.pull();
    mutate(pr);
    f.state.pulls = [pr];
    await assert.rejects(f.publish(), /preserve/i);
    assert.ok(
      !f.state.commands.some(
        (c) => c.args.includes("push") || c.command === "/trusted/gh",
      ),
    );
    assert.equal(f.state.previous, oldHead);
  });

test("GitHub errors redact responses, forbid redirects and offer credential guidance", async () => {
  for (const status of [401, 403, 404, 422, 500]) {
    await assert.rejects(
      githubRequest("/app", "secret", {
        fetchImpl: async (_url, options) => {
          assert.equal(options.redirect, "error");
          return new Response("secret response", { status });
        },
      }),
      (error) =>
        !error.message.includes("secret") &&
        error.message.includes(String(status)),
    );
  }
  assert.equal(
    await githubRequest("/missing", "secret", {
      allow404: true,
      fetchImpl: async () => new Response(null, { status: 404 }),
    }),
    null,
  );
});

test("protected configuration rejects missing files, repository-local keys, loose modes and symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "publisher-config-"));
  const checkout = mkdtempSync(join(tmpdir(), "publisher-checkout-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(checkout, { recursive: true, force: true });
  });
  const publisher = join(root, "publish.mjs");
  const configPath = join(root, "config.json");
  const keyPath = join(root, "key.pem");
  writeFileSync(publisher, "");
  writeFileSync(keyPath, key, { mode: 0o600 });
  const config = {
    appId: 123,
    clientId: "Iv123",
    installationId: 456,
    botId: 789,
    repository: "owner/repo",
    slug: "briko",
    ghPath: "/usr/bin/true",
    privateKeyPath: keyPath,
  };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  assert.equal(readProtectedConfig(configPath, checkout, publisher).key, key);
  chmodSync(keyPath, 0o644);
  assert.throws(
    () => readProtectedConfig(configPath, checkout, publisher),
    /mode 600/,
  );
  chmodSync(keyPath, 0o600);
  const symlink = join(root, "link.pem");
  symlinkSync(keyPath, symlink);
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, privateKeyPath: symlink }),
  );
  assert.throws(
    () => readProtectedConfig(configPath, checkout, publisher),
    /regular files/,
  );
  writeFileSync(join(checkout, "publish.mjs"), "");
  assert.throws(
    () =>
      readProtectedConfig(configPath, checkout, join(checkout, "publish.mjs")),
    /reviewed copy/,
  );
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, privateKeyPath: join(checkout, "key.pem") }),
  );
  writeFileSync(join(checkout, "key.pem"), key, { mode: 0o600 });
  assert.throws(
    () => readProtectedConfig(configPath, checkout, publisher),
    /outside the checkout/,
  );
});
