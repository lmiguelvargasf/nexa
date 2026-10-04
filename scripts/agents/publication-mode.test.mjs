import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publicationPlan } from "./publication-mode.mjs";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "publication-mode-checkout-"));
  const protectedRoot = mkdtempSync(
    join(tmpdir(), "publication-mode-protected-"),
  );
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(protectedRoot, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("/usr/bin/git", args, { cwd, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("remote", "add", "origin", "git@github.com:template-user/project.git");
  const set = (name, value) =>
    git("config", "--local", `nexa.publication.${name}`, value);
  const publisherPath = join(protectedRoot, "publish.mjs");
  const configPath = join(protectedRoot, "config.json");
  writeFileSync(publisherPath, "// reviewed publisher", { mode: 0o600 });
  // This deliberately cannot be parsed: mode selection must never read credentials.
  writeFileSync(configPath, "unread App configuration", { mode: 0o600 });
  const app = () => {
    set("mode", "app");
    set("repository", "template-user/project");
    set("publisherPath", publisherPath);
    set("configPath", configPath);
  };
  return { cwd, git, set, publisherPath, configPath, app };
}

test("a template clone needs no App settings or credentials", (t) => {
  const f = fixture(t);
  assert.deepEqual(publicationPlan(f.cwd), {
    mode: "github",
    repository: "template-user/project",
  });
  f.set("mode", "github");
  assert.deepEqual(publicationPlan(f.cwd), {
    mode: "github",
    repository: "template-user/project",
  });
});

test("App selection resolves external paths without reading App credentials", (t) => {
  const f = fixture(t);
  f.app();
  assert.deepEqual(publicationPlan(f.cwd), {
    mode: "app",
    repository: "template-user/project",
    publisherPath: f.publisherPath,
    configPath: f.configPath,
  });
});

test("publisher choice is local and does not leak through a template copy", (t) => {
  const original = fixture(t);
  original.app();
  const copy = fixture(t);
  assert.equal(publicationPlan(original.cwd).mode, "app");
  assert.equal(publicationPlan(copy.cwd).mode, "github");
});

test("included Git settings cannot silently select a publisher", (t) => {
  const f = fixture(t);
  const included = join(f.cwd, "included.config");
  writeFileSync(included, '[nexa "publication"]\nmode = app\n');
  f.git("config", "--local", "include.path", included);
  assert.equal(publicationPlan(f.cwd).mode, "github");
});

test("global publisher settings are ignored", (t) => {
  const f = fixture(t);
  const globalConfig = join(f.cwd, "global.config");
  writeFileSync(globalConfig, '[nexa "publication"]\nmode = app\n');
  const git = (args) =>
    execFileSync("/usr/bin/git", args, {
      cwd: f.cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig },
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  assert.equal(publicationPlan(f.cwd, git).mode, "github");
});

for (const field of ["repository", "publisherPath", "configPath"]) {
  test(`selected App with missing ${field} stops instead of falling back`, (t) => {
    const f = fixture(t);
    f.app();
    f.git("config", "--local", "--unset", `nexa.publication.${field}`);
    assert.throws(() => publicationPlan(f.cwd), /App mode requires/);
  });
}

test("partial App setup and unknown modes fail closed", (t) => {
  const f = fixture(t);
  f.set("configPath", "");
  assert.throws(() => publicationPlan(f.cwd), /select app explicitly/);
  f.set("mode", "github");
  assert.throws(() => publicationPlan(f.cwd), /select app explicitly/);
  f.set("mode", "typo");
  assert.throws(() => publicationPlan(f.cwd), /must be github or app/);
});

test("selected App with missing files stops instead of falling back", (t) => {
  const f = fixture(t);
  f.app();
  rmSync(f.configPath);
  assert.throws(() => publicationPlan(f.cwd), /unavailable.*No login fallback/);
});

test("destination changes and conflicting/multiple remotes block publication", (t) => {
  const f = fixture(t);
  f.app();
  f.git("remote", "set-url", "origin", "git@github.com:other/repo.git");
  assert.throws(() => publicationPlan(f.cwd), /repository pin differs/);
  f.git(
    "remote",
    "set-url",
    "--push",
    "origin",
    "git@github.com:template-user/project.git",
  );
  assert.throws(() => publicationPlan(f.cwd), /destinations differ/);
  f.git(
    "remote",
    "set-url",
    "--push",
    "--add",
    "origin",
    "git@github.com:other/repo.git",
  );
  assert.throws(() => publicationPlan(f.cwd), /single credential-free/);
});

test("App paths must be absolute, external, private regular files", (t) => {
  const f = fixture(t);
  f.app();
  f.set("configPath", "config.json");
  assert.throws(() => publicationPlan(f.cwd), /must be absolute/);
  const local = join(f.cwd, "config.json");
  writeFileSync(local, "{}", { mode: 0o600 });
  f.set("configPath", local);
  assert.throws(() => publicationPlan(f.cwd), /outside the checkout/);
  const link = join(f.cwd, "linked.json");
  symlinkSync(f.configPath, link);
  f.set("configPath", link);
  assert.throws(() => publicationPlan(f.cwd), /regular publisher\/config/);
  f.set("configPath", f.configPath);
  chmodSync(f.configPath, 0o644);
  assert.throws(() => publicationPlan(f.cwd), /mode-600/);
});

test("malformed local Git configuration is not treated as absent", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      publicationPlan(f.cwd, (args) => {
        if (args[0] === "rev-parse") return f.cwd;
        if (args[0] !== "config")
          return "git@github.com:template-user/project.git";
        throw Object.assign(new Error("invalid config"), { status: 128 });
      }),
    /cannot read local publisher settings/,
  );
});

test("inspection from a subdirectory still protects the entire checkout", (t) => {
  const f = fixture(t);
  f.app();
  const subdirectory = join(f.cwd, "src");
  mkdirSync(subdirectory);
  const local = join(f.cwd, "local-config.json");
  writeFileSync(local, "{}", { mode: 0o600 });
  f.set("configPath", local);
  assert.throws(() => publicationPlan(subdirectory), /outside the checkout/);
});
