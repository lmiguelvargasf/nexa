import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  hashDirectory,
  hashLicenses,
  prepare,
  verifySources,
} from "./prepare.mjs";

const OLD = "1".repeat(40);
const NEW = "2".repeat(40);
const REVIEWED = "3".repeat(40);
const SOURCE = "example/skills";

function write(root, file, contents) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents);
}

function fixture(t, { name = "demo", previousRef, unchanged = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "skill-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "checkout");
  const scratch = path.join(root, "scratch");
  const oldSource = path.join(root, "old");
  const newSource = path.join(root, "new");
  const skillPath = `skills/${name}/SKILL.md`;
  write(oldSource, skillPath, `---\nname: ${name}\n---\nOld instructions.\n`);
  write(oldSource, "LICENSE", "Copyright example\nPermission granted.\n");
  write(
    oldSource,
    `skills/${name}/references/details.md`,
    "Bundled reference.\n",
  );
  cpSync(oldSource, newSource, { recursive: true });
  if (!unchanged)
    write(newSource, skillPath, `---\nname: ${name}\n---\nNew instructions.\n`);
  mkdirSync(path.join(cwd, ".agents", "skills"), { recursive: true });
  cpSync(
    path.join(oldSource, "skills", name),
    path.join(cwd, ".agents", "skills", name),
    { recursive: true },
  );
  write(cwd, "AGENTS.md", "Repository guidance must remain unchanged.\n");
  write(cwd, ".github/ISSUE_TEMPLATE/bug.md", "Repository issue template.\n");
  const entry = {
    source: SOURCE,
    sourceType: "github",
    skillPath,
    computedHash: hashDirectory(path.join(oldSource, "skills", name)),
  };
  if (previousRef) entry.ref = previousRef;
  write(
    cwd,
    "skills-lock.json",
    `${JSON.stringify({ version: 1, skills: { [name]: entry } }, null, 2)}\n`,
  );
  const fetches = [];
  const installs = [];
  const sources = new Map([
    [OLD, oldSource],
    [NEW, newSource],
  ]);
  const fetchSource = async ({ source, ref, directory }) => {
    fetches.push({ source, ref });
    const resolved = ref ?? NEW;
    assert(sources.has(resolved), `Fixture lacks ${resolved}`);
    cpSync(sources.get(resolved), directory, { recursive: true });
    return { directory, ref: resolved };
  };
  const installSkill = async ({
    source,
    ref,
    skillPath: installedPath,
    name: installedName,
    directory,
  }) => {
    installs.push({
      source,
      ref,
      skillPath: installedPath,
      name: installedName,
    });
    const sourceDirectory = sources.get(ref);
    const destination = path.join(
      directory,
      ".agents",
      "skills",
      installedName,
    );
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(
      path.join(sourceDirectory, path.dirname(installedPath)),
      destination,
      { recursive: true },
    );
    write(
      directory,
      "skills-lock.json",
      JSON.stringify({
        version: 1,
        skills: {
          [installedName]: {
            source,
            ref,
            sourceType: "github",
            skillPath: installedPath,
            computedHash: hashDirectory(
              path.join(sourceDirectory, path.dirname(installedPath)),
            ),
          },
        },
      }),
    );
    // Even if the CLI writes an incidental agent directory, it cannot escape staging.
    write(directory, ".claude/skills/unwanted/SKILL.md", "Do not copy me.\n");
  };
  const options = { cwd, scratch, fetchSource, installSkill };
  const approve = (ref = OLD) => {
    const source = sources.get(ref);
    write(
      cwd,
      ".github/skills-review.json",
      JSON.stringify({
        version: 1,
        skills: {
          [name]: {
            source: SOURCE,
            ref,
            skillPath,
            computedHash: hashDirectory(path.join(source, "skills", name)),
            licenseHash: hashLicenses(source, skillPath),
          },
        },
      }),
    );
    write(
      cwd,
      ".agents/licenses/github-awesome-copilot-LICENSE",
      readFileSync(path.join(oldSource, "LICENSE")),
    );
  };
  return {
    ...options,
    options,
    oldSource,
    newSource,
    skillPath,
    name,
    sources,
    fetches,
    installs,
    approve,
    root,
  };
}

test("prepares a changed skill, lock and attribution without inventing previous provenance", async (t) => {
  const f = fixture(t);
  const prepared = await prepare(f.options);
  assert.equal(prepared.changes.length, 1);
  assert.equal(prepared.changes[0].previousRef, null);
  assert.equal(prepared.changes[0].ref, NEW);
  assert.equal(f.installs.length, 1);
  assert.equal(
    readFileSync(path.join(f.cwd, ".agents/skills/demo/SKILL.md"), "utf8"),
    readFileSync(path.join(f.newSource, f.skillPath), "utf8"),
  );
  assert.equal(
    readFileSync(
      path.join(f.cwd, ".agents/skills/demo/references/details.md"),
      "utf8",
    ),
    "Bundled reference.\n",
  );
  assert.equal(
    readFileSync(
      path.join(f.cwd, ".agents/licenses/example--skills/LICENSE"),
      "utf8",
    ),
    readFileSync(path.join(f.newSource, "LICENSE"), "utf8"),
  );
  assert.equal(
    readFileSync(path.join(f.cwd, "AGENTS.md"), "utf8"),
    "Repository guidance must remain unchanged.\n",
  );
  assert.equal(
    readFileSync(path.join(f.cwd, ".github/ISSUE_TEMPLATE/bug.md"), "utf8"),
    "Repository issue template.\n",
  );
  assert(!existsSync(path.join(f.cwd, ".claude")));
  assert.deepEqual(verifySources({ cwd: f.cwd, prepared }), {
    checked: ["demo"],
  });
});

test("same source bytes do not install or add provenance-only metadata", async (t) => {
  const f = fixture(t, { unchanged: true });
  const before = readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8");
  const prepared = await prepare(f.options);
  assert.deepEqual(prepared.changes, []);
  assert.deepEqual(f.installs, []);
  assert.equal(
    readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8"),
    before,
  );
  assert(!existsSync(path.join(f.cwd, ".agents/licenses")));
});

test("a repeated changed run becomes a no-change run", async (t) => {
  const f = fixture(t);
  await prepare(f.options);
  const repeated = await prepare({
    ...f.options,
    scratch: path.join(f.root, "repeat"),
  });
  assert.deepEqual(repeated.changes, []);
  assert.equal(f.installs.length, 1);
});

test("proposes license-only revisions once attribution provenance is recorded", async (t) => {
  const f = fixture(t);
  const first = await prepare(f.options);
  write(f.newSource, "LICENSE", "Reviewed replacement license.\n");
  f.sources.set(REVIEWED, f.newSource);
  const updated = await prepare({
    ...f.options,
    scratch: path.join(f.root, "license-update"),
    fetchSource: (options) =>
      f.fetchSource({ ...options, ref: options.ref ?? REVIEWED }),
  });
  assert.equal(updated.changes.length, 1);
  assert.equal(
    updated.changes[0].previousHash,
    updated.changes[0].computedHash,
  );
  assert.equal(
    updated.changes[0].previousLicenseHash,
    first.changes[0].licenseHash,
  );
  assert.notEqual(
    updated.changes[0].previousLicenseHash,
    updated.changes[0].licenseHash,
  );
  assert.equal(updated.changes[0].ref, REVIEWED);
  assert.equal(
    readFileSync(
      path.join(f.cwd, ".agents/licenses/example--skills/LICENSE"),
      "utf8",
    ),
    "Reviewed replacement license.\n",
  );
});

test("keeps github-issues pinned and reports a newer unreviewed candidate", async (t) => {
  const f = fixture(t, { name: "github-issues", previousRef: OLD });
  f.approve();
  const before = readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8");
  const prepared = await prepare(f.options);
  assert.deepEqual(prepared.changes, []);
  assert.equal(prepared.pending[0].ref, NEW);
  assert.equal(prepared.pending[0].approvedRef, OLD);
  assert.equal(
    prepared.pending[0].computedHash,
    hashDirectory(path.join(f.newSource, "skills/github-issues")),
  );
  assert.deepEqual(f.installs, []);
  assert.equal(
    readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8"),
    before,
  );
  assert.deepEqual(verifySources({ cwd: f.cwd, prepared }), {
    checked: ["github-issues"],
  });
});

test("a removed unreviewed github-issues path remains pending without changing the reviewed installation", async (t) => {
  const f = fixture(t, { name: "github-issues", previousRef: OLD });
  f.approve();
  rmSync(path.join(f.newSource, "skills/github-issues"), { recursive: true });
  const prepared = await prepare(f.options);
  assert.deepEqual(prepared.changes, []);
  assert.equal(prepared.pending[0].ref, NEW);
  assert.equal(prepared.pending[0].computedHash, null);
  assert.match(
    prepared.pending[0].reason,
    /review the upstream retirement or move/,
  );
  assert.deepEqual(f.installs, []);
});

test("installs only a reviewed github-issues commit and synchronizes license bytes", async (t) => {
  const f = fixture(t, { name: "github-issues", previousRef: OLD });
  write(
    f.newSource,
    "LICENSE",
    "Changed and reviewed license, without final newline",
  );
  f.approve(NEW);
  const prepared = await prepare(f.options);
  assert.equal(prepared.changes[0].previousRef, OLD);
  assert.equal(prepared.changes[0].ref, NEW);
  assert.deepEqual(prepared.pending, []);
  assert.equal(
    readFileSync(
      path.join(f.cwd, ".agents/licenses/github-awesome-copilot-LICENSE"),
      "utf8",
    ),
    "Changed and reviewed license, without final newline",
  );
});

test("can install a reviewed commit while a newer candidate remains pending", async (t) => {
  const f = fixture(t, { name: "github-issues", previousRef: OLD });
  const reviewed = path.join(f.root, "reviewed");
  cpSync(f.newSource, reviewed, { recursive: true });
  write(reviewed, f.skillPath, "Reviewed intermediate instructions.\n");
  f.sources.set(REVIEWED, reviewed);
  f.approve(REVIEWED);
  const prepared = await prepare(f.options);
  assert.equal(prepared.changes[0].ref, REVIEWED);
  assert.equal(prepared.pending[0].ref, NEW);
  assert.equal(f.installs[0].ref, REVIEWED);
});

test("rejects missing approvals and source or license hashes that do not match review", async (t) => {
  for (const problem of ["missing", "source", "license"]) {
    const f = fixture(t, { name: "github-issues", previousRef: OLD });
    if (problem !== "missing") {
      f.approve(NEW);
      write(
        f.newSource,
        problem === "license" ? "LICENSE" : f.skillPath,
        "Unreviewed change.\n",
      );
    }
    await assert.rejects(
      prepare(f.options),
      /review approval|hash does not match upstream/,
    );
    assert.deepEqual(f.installs, []);
  }
});

test("post-hook verification catches modified vendor bytes, lock metadata and licenses", async (t) => {
  for (const target of ["skill", "license", "lock"]) {
    const f = fixture(t, { name: "github-issues", previousRef: OLD });
    f.approve(NEW);
    const prepared = await prepare(f.options);
    if (target === "lock") {
      const lock = JSON.parse(
        readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8"),
      );
      lock.skills["github-issues"].ref = OLD;
      write(f.cwd, "skills-lock.json", JSON.stringify(lock));
    } else {
      write(
        f.cwd,
        target === "skill"
          ? ".agents/skills/github-issues/SKILL.md"
          : ".agents/licenses/github-awesome-copilot-LICENSE",
        "Hook reformatted bytes.\n",
      );
    }
    assert.throws(
      () => verifySources({ cwd: f.cwd, prepared }),
      /bytes differ|hash changed/,
    );
  }
});

test("fails a retired source path or failed fetch without claiming successful preparation", async (t) => {
  const retired = fixture(t);
  rmSync(path.join(retired.newSource, "skills/demo"), { recursive: true });
  await assert.rejects(
    prepare(retired.options),
    /demo: source preparation failed/,
  );
  assert.deepEqual(retired.installs, []);
  const failed = fixture(t);
  await assert.rejects(
    prepare({
      ...failed.options,
      fetchSource: async () => {
        throw new Error("upstream unavailable");
      },
    }),
    /demo: source preparation failed: upstream unavailable/,
  );
});

test("rejects unsafe manifest paths before fetching", async (t) => {
  const f = fixture(t);
  const lock = JSON.parse(
    readFileSync(path.join(f.cwd, "skills-lock.json"), "utf8"),
  );
  lock.skills.demo.skillPath = "../outside/SKILL.md";
  write(f.cwd, "skills-lock.json", JSON.stringify(lock));
  await assert.rejects(prepare(f.options), /invalid source skillPath/);
  assert.deepEqual(f.fetches, []);
});

test("rejects source symlinks and unexpected installer source metadata", async (t) => {
  const linked = fixture(t);
  symlinkSync(
    "../LICENSE",
    path.join(linked.newSource, "skills/demo/linked.md"),
  );
  await assert.rejects(prepare(linked.options), /Symlink is unsupported/);
  const wrong = fixture(t);
  await assert.rejects(
    prepare({
      ...wrong.options,
      installSkill: async (options) => {
        await wrong.installSkill(options);
        const file = path.join(options.directory, "skills-lock.json");
        const lock = JSON.parse(readFileSync(file, "utf8"));
        lock.skills.demo.source = "unrelated/repository";
        writeFileSync(file, JSON.stringify(lock));
      },
    }),
    /installer lock source, path, revision, or hash mismatch/,
  );
});

test("preserves metadata omitted by the pinned CLI but rejects arbitrary missing references", async (t) => {
  const metadata = fixture(t);
  write(metadata.newSource, "skills/demo/metadata.json", '{"version": 2}\n');
  await prepare({
    ...metadata.options,
    installSkill: async (options) => {
      await metadata.installSkill(options);
      rmSync(path.join(options.directory, ".agents/skills/demo/metadata.json"));
    },
  });
  assert.equal(
    readFileSync(
      path.join(metadata.cwd, ".agents/skills/demo/metadata.json"),
      "utf8",
    ),
    '{"version": 2}\n',
  );
  const omitted = fixture(t);
  await assert.rejects(
    prepare({
      ...omitted.options,
      installSkill: async (options) => {
        await omitted.installSkill(options);
        rmSync(
          path.join(
            options.directory,
            ".agents/skills/demo/references/details.md",
          ),
        );
      },
    }),
    /Installer omitted an unexpected bundled file/,
  );
});

test("matches CLI path-and-byte hashing and preserves ancestor and third-party notices", (t) => {
  const f = fixture(t);
  write(
    f.newSource,
    "skills/demo/node_modules/ignored.txt",
    "Ignored by CLI hash.\n",
  );
  const hash = createHash("sha256")
    .update("references/details.md")
    .update("Bundled reference.\n")
    .update("SKILL.md")
    .update(readFileSync(path.join(f.newSource, f.skillPath)))
    .digest("hex");
  assert.equal(hashDirectory(path.join(f.newSource, "skills/demo")), hash);
  const before = hashLicenses(f.newSource, f.skillPath);
  write(f.newSource, "THIRD_PARTY_NOTICES.md", "Third-party notice.\n");
  write(f.newSource, "skills/LICENSE.md", "Ancestor license.\n");
  assert.notEqual(hashLicenses(f.newSource, f.skillPath), before);
});
