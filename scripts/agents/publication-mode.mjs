import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryFromUrl } from "./publish.mjs";

const runGit = (cwd, args) =>
  execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function fail(message) {
  throw new Error(`Agent publication stopped: ${message}`);
}

/** Resolve local policy without reading credentials or publishing anything. */
export function publicationPlan(cwd, git = (args) => runGit(cwd, args)) {
  const root = realpathSync(git(["rev-parse", "--show-toplevel"]));
  const repository = repositoryFromUrl(
    git(["remote", "get-url", "--all", "origin"]),
  );
  const pushRepository = repositoryFromUrl(
    git(["remote", "get-url", "--push", "--all", "origin"]),
  );
  if (repository.toLowerCase() !== pushRepository.toLowerCase())
    fail("origin fetch and push destinations differ; reconcile them first.");

  const setting = (key) => {
    try {
      return git(["config", "--local", "--no-includes", "--get", key]);
    } catch (error) {
      if (error.status === 1) return undefined;
      fail("cannot read local publisher settings; check .git/config.");
    }
  };
  const mode = setting("nexa.publication.mode");
  const pin = setting("nexa.publication.repository");
  const publisherPath = setting("nexa.publication.publisherPath");
  const configPath = setting("nexa.publication.configPath");
  if (pin !== undefined && pin.toLowerCase() !== repository.toLowerCase())
    fail("local publisher repository pin differs from origin; reconfigure it.");
  if (
    (mode === undefined || mode === "github") &&
    (publisherPath !== undefined || configPath !== undefined)
  )
    fail("App paths are configured without App mode; select app explicitly.");
  if (mode === undefined || mode === "github")
    return { mode: "github", repository };
  if (mode !== "app") fail("nexa.publication.mode must be github or app.");
  if (!pin || !publisherPath || !configPath)
    fail(
      "App mode requires repository, publisherPath and configPath; no login fallback.",
    );
  for (const path of [publisherPath, configPath]) {
    if (!isAbsolute(path))
      fail("App publisher and config paths must be absolute.");
    try {
      const info = lstatSync(path);
      const rel = relative(root, realpathSync(path));
      if (
        !info.isFile() ||
        info.uid !== process.getuid() ||
        (info.mode & 0o077) !== 0 ||
        rel === "" ||
        (!rel.startsWith("..") && !isAbsolute(rel))
      )
        fail(
          "use owned mode-600 regular publisher/config files outside the checkout.",
        );
    } catch (error) {
      if (error.message.startsWith("Agent publication stopped:")) throw error;
      fail(
        "selected App publisher/config is unavailable; provision it. No login fallback.",
      );
    }
  }
  return { mode, repository, publisherPath, configPath };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length > 3)
      fail("usage: node publication-mode.mjs [checkout]");
    process.stdout.write(
      `${JSON.stringify(publicationPlan(process.argv[2] ?? process.cwd()))}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
