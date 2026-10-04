import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const API = "https://api.github.com";
const SHA = /^[a-f0-9]{40}$/;
const marker = (issue) => `<!-- agent-publisher:v1 issue:${issue} -->`;
const referencesIssue = (body, issue) =>
  new RegExp(`(?:#${issue}\\b|/issues/${issue}\\b)`).test(body);
const safeEnv = () => ({
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
});
const runCommand = (command, args, options) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

function fail(message) {
  throw new Error(`Agent publication stopped: ${message}`);
}

export function repositoryFromUrl(url) {
  const match = url
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
  if (
    !match ||
    match[1].split("/").some((part) => part === "." || part === "..")
  )
    fail("origin must be a single credential-free github.com OWNER/REPO URL.");
  return match[1];
}

export function validateReport(body, template, issue) {
  for (const heading of template.match(/^## .+$/gm) ?? []) {
    const start = body.indexOf(`${heading}\n`);
    if (start < 0) fail(`PR report is missing template heading ${heading}.`);
    const section = body.slice(start + heading.length).split(/\n## /)[0];
    if (!section.replace(/<!--[\s\S]*?-->/g, "").trim())
      fail(`PR report has an empty section: ${heading}.`);
  }
  if (!referencesIssue(body, issue))
    fail(`PR report must reference issue #${issue}.`);
  if (!/`(?:mise exec -- )?task verify(?:[:\s`])/.test(body))
    fail("PR report must record the exact task verify command and outcome.");
  if (/<!--/.test(body.replace(/<!-- agent-publisher:[\s\S]*?-->/g, "")))
    fail("fill the template instructions before publication.");
}

export function makeJwt(clientId, key, now = Date.now()) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(now / 1000);
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: clientId,
    iat: seconds - 60,
    exp: seconds + 540,
  })}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), key).toString("base64url")}`;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function readProtectedConfig(path, checkout, publisher) {
  const root = realpathSync(checkout);
  if (inside(root, realpathSync(publisher)))
    fail(
      "run a reviewed copy of the publisher outside the checkout; see docs/agent-publication.md.",
    );
  const secureFile = (filename) => {
    if (!isAbsolute(filename)) fail("credential paths must be absolute.");
    const info = lstatSync(filename);
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid()
    )
      fail(
        "config and private key must be owned by you, regular files, with mode 600.",
      );
    if (inside(root, realpathSync(filename)))
      fail("keep App credentials outside the checkout and its worktrees.");
    return readFileSync(filename, "utf8");
  };
  let config;
  try {
    config = JSON.parse(secureFile(path));
    if (
      !Number.isSafeInteger(config.appId) ||
      config.appId <= 0 ||
      !Number.isSafeInteger(config.installationId) ||
      config.installationId <= 0 ||
      !Number.isSafeInteger(config.botId) ||
      config.botId <= 0 ||
      !/^[A-Za-z0-9_-]+$/.test(config.clientId ?? "") ||
      !/^[a-z0-9-]+$/.test(config.slug ?? "") ||
      !/^[\w-]+\/[\w.-]+$/.test(config.repository ?? "") ||
      !isAbsolute(config.ghPath ?? "")
    )
      fail(
        "config requires valid appId, clientId, installationId, slug, botId, repository and absolute ghPath.",
      );
    config.key = secureFile(config.privateKeyPath);
  } catch (error) {
    if (error.message.startsWith("Agent publication stopped:")) throw error;
    fail(
      "cannot read protected App config/key; provision mode-600 files outside the checkout (docs/agent-publication.md).",
    );
  }
  if (inside(root, realpathSync(config.ghPath)))
    fail("gh must be a trusted executable outside the checkout.");
  return config;
}

/** No secrets in argv, remote URLs, report files or logs. API errors never echo responses. */
export async function githubRequest(
  path,
  token,
  { method = "GET", body, fetchImpl = fetch, allow404 = false } = {},
) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    fail(
      "GitHub request failed; check network access, inspect existing publication state, then rerun.",
    );
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const help =
      response.status === 401
        ? "check clock, App key/IDs and revoked or expired credentials"
        : response.status === 403 || response.status === 404
          ? "check installation, selected repository and App permissions"
          : "inspect existing state before retrying; check GitHub availability and rate limits";
    fail(
      `GitHub ${method} ${path} returned ${response.status}; ${help}. No maintainer-login fallback.`,
    );
  }
  return response.status === 204 ? null : response.json();
}

export function selectPull(
  pulls,
  { repository, branch, base, issue, botId, slug },
) {
  const open = pulls.filter((pr) => pr.state === "open");
  if (open.length > 1)
    fail("multiple open PRs share the branch; reconcile manually.");
  const pr = open[0];
  if (
    pr &&
    (pr.user?.type !== "Bot" ||
      pr.user.id !== botId ||
      pr.user.login !== `${slug}[bot]` ||
      pr.base.ref !== base ||
      pr.base.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
      pr.head.ref !== branch ||
      pr.head.repo?.full_name.toLowerCase() !== repository.toLowerCase() ||
      !pr.body?.includes(marker(issue)) ||
      !referencesIssue(pr.body, issue))
  )
    fail(
      "existing PR has unrelated ownership, issue or destination; preserve it. Historical authorship cannot be transferred.",
    );
  if (!pr && pulls.length)
    fail(
      "a previous PR used this branch; preserve it and use a new issue branch for new work.",
    );
  return pr;
}

/** Inputs are read as data. Only a credential-free Git export touches the candidate checkout. */
export async function publish({
  cwd,
  config,
  issue,
  base = "main",
  title,
  bodyPath,
  draft = false,
  run = runCommand,
  request = githubRequest,
  now = () => Date.now(),
}) {
  const git = (...args) => {
    try {
      return run("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd,
        env: safeEnv(),
      }).trim();
    } catch {
      fail(
        "candidate Git inspection failed; check the checkout and branch. No credential was passed to candidate code.",
      );
    }
  };
  if (!Number.isSafeInteger(issue) || issue <= 0 || !title?.trim())
    fail("provide --issue and --title.");
  const branch = git("symbolic-ref", "--short", "HEAD");
  git("check-ref-format", "--branch", base);
  if (branch === base || !branch.startsWith(`issue/${issue}-`))
    fail(`publish from issue/${issue}-<description>, distinct from the base.`);
  if (git("status", "--porcelain"))
    fail(
      "commit the reviewed, validated changes before publishing; checkout is dirty.",
    );
  const repository = repositoryFromUrl(git("remote", "get-url", "origin"));
  if (
    repositoryFromUrl(
      git("remote", "get-url", "--push", "--all", "origin"),
    ).toLowerCase() !== repository.toLowerCase() ||
    config.repository.toLowerCase() !== repository.toLowerCase()
  )
    fail(
      "fetch/push destination or protected repository pin differs from this clone.",
    );
  const head = git("rev-parse", "HEAD");
  const baseSha = git("rev-parse", `refs/remotes/origin/${base}`);
  if (!SHA.test(head) || !SHA.test(baseSha))
    fail("fetch and validate the intended base first.");
  git("merge-base", "--is-ancestor", baseSha, head);
  if (head === baseSha) fail("there are no implementation commits to publish.");
  const workflows =
    git("diff", "--name-only", baseSha, head, "--", ".github/workflows/") !==
    "";
  const body = readFileSync(bodyPath, "utf8").trim();
  const template = git("show", `${baseSha}:.github/pull_request_template.md`);
  validateReport(body, template, issue);
  const jwt = makeJwt(config.clientId, config.key, now());
  const app = await request("/app", jwt);
  if (
    app.id !== config.appId ||
    app.client_id !== config.clientId ||
    app.slug !== config.slug
  )
    fail(
      "App identity differs from the protected registration; verify appId/clientId/slug and key.",
    );
  const allowedPermissions = new Set([
    "contents",
    "pull_requests",
    "metadata",
    "workflows",
  ]);
  if (Object.keys(app.permissions).some((key) => !allowedPermissions.has(key)))
    fail("App has unnecessary permissions; remove them before publishing.");
  const installation = await request(`/repos/${repository}/installation`, jwt);
  if (
    installation.id !== config.installationId ||
    installation.app_id !== config.appId ||
    installation.repository_selection !== "selected" ||
    installation.suspended_at ||
    installation.account.login.toLowerCase() !==
      repository.split("/")[0].toLowerCase()
  )
    fail(
      "installation is suspended, incorrectly scoped or different from the protected installation. Select only the intended repository.",
    );
  const permissions = {
    contents: "write",
    pull_requests: "write",
    ...(workflows ? { workflows: "write" } : {}),
  };
  for (const [name, access] of Object.entries(permissions)) {
    if (installation.permissions[name] !== access)
      fail(
        `installation needs ${name}:${access}; approve the required permission, then rerun.`,
      );
  }
  const issued = await request(
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    {
      method: "POST",
      body: { repositories: [repository.split("/")[1]], permissions },
    },
  );
  const token = issued.token;
  if (!token)
    fail(
      "GitHub did not return an installation token; check installation setup.",
    );
  let temp;
  try {
    if (
      !Number.isFinite(Date.parse(issued.expires_at)) ||
      Date.parse(issued.expires_at) < now() + 60_000 ||
      !issued.repositories ||
      issued.repositories.length !== 1 ||
      issued.repositories[0].full_name.toLowerCase() !==
        repository.toLowerCase() ||
      Object.keys(issued.permissions).some(
        (key) => key !== "metadata" && !(key in permissions),
      ) ||
      Object.entries(permissions).some(
        ([key, value]) => issued.permissions[key] !== value,
      )
    )
      fail(
        "token is expired or incorrectly scoped; fix installation permissions and rerun to renew it.",
      );
    const api = (path, options) => request(path, token, options);
    const bot = await api(
      `/users/${encodeURIComponent(`${config.slug}[bot]`)}`,
    );
    if (
      bot.id !== config.botId ||
      bot.login !== `${config.slug}[bot]` ||
      bot.type !== "Bot"
    )
      fail("configured bot ID/login does not match the registered App bot.");
    const repo = await api(`/repos/${repository}`);
    if (repo.full_name.toLowerCase() !== repository.toLowerCase())
      fail("GitHub repository identity changed.");
    const issueData = await api(`/repos/${repository}/issues/${issue}`);
    if (issueData.pull_request)
      fail(
        "the requested issue number identifies a PR; verify the implementation issue.",
      );
    const ref = async (name) =>
      (
        await api(
          `/repos/${repository}/git/ref/heads/${name.split("/").map(encodeURIComponent).join("/")}`,
          {
            allow404: true,
          },
        )
      )?.object.sha ?? "";
    if ((await ref(base)) !== baseSha)
      fail(
        "base advanced since validation; fetch, integrate and rerun validation before publication.",
      );
    const options = {
      repository,
      branch,
      base,
      issue,
      botId: config.botId,
      slug: config.slug,
    };
    const list = async () => {
      const pulls = [];
      for (let page = 1; ; page++) {
        const batch = await api(
          `/repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${repository.split("/")[0]}:${branch}`)}&per_page=100&page=${page}`,
        );
        pulls.push(...batch);
        if (batch.length < 100) return pulls;
      }
    };
    let pr = selectPull(await list(), options);
    const previous = await ref(branch);
    if (pr && (!previous || pr.head.sha !== previous))
      fail(
        "PR and remote branch disagree; rerun after concurrent publication finishes.",
      );
    if (previous && !pr && previous !== head)
      fail(
        "remote branch exists without a matching App PR; preserve it and reconcile manually.",
      );
    if (previous && previous !== head)
      git("merge-base", "--is-ancestor", previous, head);
    temp = mkdtempSync(join(tmpdir(), "agent-publication-"));
    chmodSync(temp, 0o700);
    const bare = join(temp, "export.git");
    const isolated = (command, args, env = {}) => {
      try {
        return run(command, args, {
          cwd: temp,
          env: { ...safeEnv(), ...env },
        }).trim();
      } catch {
        fail(
          "publication command failed (permissions, expired token or concurrent branch edit); inspect remote state and rerun. No maintainer-login fallback.",
        );
      }
    };
    const gh = (...args) =>
      isolated(config.ghPath, args, {
        GH_TOKEN: token,
        GH_HOST: "github.com",
        GH_CONFIG_DIR: join(temp, "gh"),
        GH_PROMPT_DISABLED: "1",
        HOME: temp,
      });
    const current = selectPull(await list(), options);
    if (
      (pr?.number ?? null) !== (current?.number ?? null) ||
      (await ref(base)) !== baseSha
    )
      fail(
        "PR or base changed while preparing publication; rerun validation/inspection.",
      );
    if (previous !== head) {
      // Export committed objects without credentials or invoking any checkout code.
      git(
        "bundle",
        "create",
        join(temp, "candidate.bundle"),
        `refs/heads/${branch}`,
      );
      isolated("/usr/bin/git", ["init", "--bare", bare]);
      isolated("/usr/bin/git", [
        "--git-dir",
        bare,
        "fetch",
        join(temp, "candidate.bundle"),
        `refs/heads/${branch}:refs/heads/candidate`,
      ]);
      const askpass = join(temp, "askpass.sh");
      writeFileSync(
        askpass,
        '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$BRIKO_PUSH_TOKEN" ;; esac\n',
        { mode: 0o700 },
      );
      isolated(
        "/usr/bin/git",
        [
          "--git-dir",
          bare,
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "credential.helper=",
          "push",
          `--force-with-lease=refs/heads/${branch}:${previous}`,
          `https://github.com/${repository}.git`,
          `${head}:refs/heads/${branch}`,
        ],
        { GIT_ASKPASS: askpass, BRIKO_PUSH_TOKEN: token, HOME: temp },
      );
    }
    const reportHash = createHash("sha256").update(body).digest("hex");
    const reportMarker = `<!-- agent-publication-report:${head}:${reportHash} -->`;
    const fullBody = `${body}\n\n${marker(issue)}\n${reportMarker}\n`;
    const reportPath = join(temp, "body.md");
    writeFileSync(reportPath, fullBody, { mode: 0o600 });
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
          title,
          "--body-file",
          reportPath,
          ...(draft ? ["--draft"] : []),
        );
      } catch (error) {
        pr = selectPull(await list(), options);
        if (!pr) throw error;
      }
      pr ??= selectPull(await list(), options);
      if (!pr)
        fail(
          "branch pushed but PR not discoverable; inspect existing state before retrying.",
        );
    } else {
      // Preserve maintainer edits to the PR description; append current validation.
      let found = pr.body.includes(reportMarker);
      for (let page = 1; !found; page++) {
        const comments = await api(
          `/repos/${repository}/issues/${pr.number}/comments?per_page=100&page=${page}`,
        );
        found = comments.some(
          (comment) =>
            comment.user.id === config.botId &&
            comment.body.includes(reportMarker),
        );
        if (found || comments.length < 100) break;
      }
      if (!found) {
        try {
          gh(
            "pr",
            "comment",
            String(pr.number),
            "--repo",
            repository,
            "--body-file",
            reportPath,
          );
        } catch {
          fail(
            "branch published but report comment failed; inspect comments and rerun to recover without duplicating the PR.",
          );
        }
      }
      if (pr.draft && !draft)
        gh("pr", "ready", String(pr.number), "--repo", repository);
      if (!pr.draft && draft)
        fail("existing PR is ready; refusing to convert it back to draft.");
    }
    const verified = await api(`/repos/${repository}/pulls/${pr.number}`);
    selectPull([verified], options);
    if (
      verified.state !== "open" ||
      verified.head.sha !== head ||
      (await ref(branch)) !== head ||
      verified.draft !== draft ||
      (created && (verified.body !== fullBody || verified.title !== title))
    )
      fail(
        "published PR verification failed; inspect the existing PR before rerunning.",
      );
    return {
      status: created ? "created" : previous === head ? "reused" : "updated",
      url: verified.html_url,
      head,
      author: verified.user.login,
    };
  } finally {
    try {
      if (temp) rmSync(temp, { recursive: true, force: true });
    } finally {
      await request("/installation/token", token, { method: "DELETE" });
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      checkout: { type: "string" },
      config: { type: "string" },
      issue: { type: "string" },
      base: { type: "string", default: "main" },
      title: { type: "string" },
      "body-file": { type: "string" },
      draft: { type: "boolean", default: false },
    },
  });
  if (!values.checkout || !values.config || !values["body-file"])
    fail(
      "usage: node <trusted-copy>/publish.mjs --checkout <path> --config <protected-json> --issue <number> --base main --title <title> --body-file <report>",
    );
  const cwd = realpathSync(values.checkout);
  const config = readProtectedConfig(
    resolve(values.config),
    cwd,
    fileURLToPath(import.meta.url),
  );
  console.log(
    JSON.stringify(
      await publish({
        cwd,
        config,
        issue: Number(values.issue),
        base: values.base,
        title: values.title,
        bodyPath: resolve(values["body-file"]),
        draft: values.draft,
      }),
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error.message.startsWith("Agent publication stopped:")
        ? error.message
        : "Agent publication stopped: setup/input error; inspect docs/agent-publication.md. Credentials were not printed.",
    );
    process.exitCode = 1;
  });
}
