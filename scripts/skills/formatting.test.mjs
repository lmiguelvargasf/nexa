import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../../", import.meta.url));
const biome = join(project, "node_modules/.bin/biome");

test("repository Biome checks preserve upstream code while enforcing owned code", (context) => {
  const cwd = mkdtempSync(join(tmpdir(), "skills-formatting-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd });
  cpSync(join(project, "biome.json"), join(cwd, "biome.json"));
  cpSync(join(project, ".gitignore"), join(cwd, ".gitignore"));
  const vendor = [
    ".agents/skills/resend/references/fetch-all-templates.mjs",
    ".agents/licenses/example/NOTICE.js",
  ];
  const upstream = "export const name = 'upstream';\r\n";
  for (const path of vendor) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), upstream);
  }
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src/example.mjs"), 'export const name = "owned";\n');
  const check = (...args) => spawnSync(biome, args, { cwd, encoding: "utf8" });
  const clean = check("check", ".");
  assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
  const directVendor = check(
    "check",
    "--write",
    "--no-errors-on-unmatched",
    ...vendor,
  );
  assert.equal(
    directVendor.status,
    0,
    `${directVendor.stdout}\n${directVendor.stderr}`,
  );
  for (const path of vendor)
    assert.equal(readFileSync(join(cwd, path), "utf8"), upstream);
  writeFileSync(join(cwd, "src/example.mjs"), "export const name = 'owned';\n");
  assert.notEqual(
    check("check", ".").status,
    0,
    "owned source formatting must still fail",
  );
  const fixed = check("check", "--write", ".");
  assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
  assert.equal(
    readFileSync(join(cwd, "src/example.mjs"), "utf8"),
    'export const name = "owned";\n',
  );
  for (const path of vendor)
    assert.equal(readFileSync(join(cwd, path), "utf8"), upstream);
});
