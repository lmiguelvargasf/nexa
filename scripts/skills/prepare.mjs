import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const CLI_VERSION = "1.5.26";
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-f0-9]{40}$/;
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const LICENSE =
  /^(licen[cs]e|copying|notice|copyright|third_party_notices)(?:[._-].*)?$/i;
const ISSUE_LICENSE = ".agents/licenses/github-awesome-copilot-LICENSE";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function relativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !path.posix.isAbsolute(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function checkEntry(name, entry) {
  assert(NAME.test(name), `Invalid tracked skill name: ${name}`);
  assert(
    entry?.sourceType === "github" && SOURCE.test(entry.source),
    `${name}: only owner/repository GitHub sources are supported`,
  );
  assert(
    relativePath(entry.skillPath) &&
      path.posix.basename(entry.skillPath) === "SKILL.md",
    `${name}: invalid source skillPath`,
  );
  assert(HASH.test(entry.computedHash), `${name}: invalid computedHash`);
  assert(
    entry.licenseHash === undefined || HASH.test(entry.licenseHash),
    `${name}: invalid licenseHash`,
  );
  assert(
    entry.ref === undefined || REF.test(entry.ref),
    `${name}: ref must be a full commit`,
  );
}

function plainPath(root, relative) {
  let current = root;
  assert(
    !lstatSync(root).isSymbolicLink(),
    `Symlink directory is unsupported: ${root}`,
  );
  for (const component of relative.split("/")) {
    current = path.join(current, component);
    assert(
      !lstatSync(current).isSymbolicLink(),
      `Symlink is unsupported: ${current}`,
    );
  }
  return current;
}

function writablePath(root, relative) {
  let current = root;
  for (const component of relative.split("/").slice(0, -1)) {
    current = path.join(current, component);
    if (existsSync(current)) {
      assert(
        lstatSync(current).isDirectory() &&
          !lstatSync(current).isSymbolicLink(),
        `Unsafe output directory: ${current}`,
      );
    } else mkdirSync(current);
  }
  const target = path.join(root, relative);
  assert(
    !existsSync(target) || !lstatSync(target).isSymbolicLink(),
    `Unsafe output file: ${target}`,
  );
  return target;
}

function files(root, prefix = "", forCliHash = false) {
  const result = [];
  for (const entry of readdirSync(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(
      !entry.isSymbolicLink(),
      `Symlink is unsupported: ${path.join(root, relative)}`,
    );
    if (entry.isDirectory()) {
      if (forCliHash && [".git", "node_modules"].includes(entry.name)) continue;
      result.push(...files(root, relative, forCliHash));
    } else {
      assert(entry.isFile(), `Unsupported source file: ${relative}`);
      result.push(relative);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function hashFiles(root, paths) {
  const hash = createHash("sha256");
  for (const relative of [...paths].sort((left, right) =>
    left.localeCompare(right),
  )) {
    hash.update(relative);
    hash.update(readFileSync(path.join(root, relative)));
  }
  return hash.digest("hex");
}

// Match the pinned CLI's source-folder hash; byte verification below also checks
// files (such as node_modules) that its hash deliberately omits.
export function hashDirectory(directory) {
  return hashFiles(directory, files(directory, "", true));
}

export function licenseFiles(directory, skillPath) {
  const result = [];
  let ancestor = "";
  const ancestors = [ancestor];
  for (const part of path.posix.dirname(skillPath).split("/")) {
    if (part === ".") continue;
    ancestor = ancestor ? `${ancestor}/${part}` : part;
    ancestors.push(ancestor);
  }
  for (const relative of ancestors) {
    for (const entry of readdirSync(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      if (!LICENSE.test(entry.name)) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      assert(
        entry.isFile() && !entry.isSymbolicLink(),
        `Unsupported license file: ${file}`,
      );
      result.push(file);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

export function hashLicenses(directory, skillPath) {
  return hashFiles(directory, licenseFiles(directory, skillPath));
}

function inventory(directory) {
  return files(directory).map((relative) => ({
    path: relative,
    hash: createHash("sha256")
      .update(readFileSync(path.join(directory, relative)))
      .digest("hex"),
  }));
}

function sameBytes(actual, expected, description) {
  assert(
    JSON.stringify(inventory(actual)) === JSON.stringify(inventory(expected)),
    `${description}: installed file list or bytes differ from the verified upstream source`,
  );
}

function preserveCliOmissions(installed, expected) {
  // Skills 1.5.26 omits these files while hashing the complete source folder.
  // Preserve bundled references/metadata without masking unexpected omissions.
  for (const relative of files(expected)) {
    const destination = path.join(installed, relative);
    if (existsSync(destination)) continue;
    assert(
      relative
        .split("/")
        .some((part) =>
          ["metadata.json", "__pycache__", "__pypackages__"].includes(part),
        ),
      `Installer omitted an unexpected bundled file: ${relative}`,
    );
    cpSync(path.join(expected, relative), writablePath(installed, relative));
  }
}

export async function fetchSource({ source, ref, directory }) {
  mkdirSync(directory, { recursive: true });
  const run = (args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run(["init", "--quiet"]);
  run(["remote", "add", "origin", `https://github.com/${source}.git`]);
  run([
    "-c",
    "credential.interactive=never",
    "fetch",
    "--quiet",
    "--depth=1",
    "origin",
    ref ?? "HEAD",
  ]);
  const resolved = run(["rev-parse", "FETCH_HEAD"]);
  assert(
    REF.test(resolved) && (!ref || resolved === ref),
    `${source}: fetched unexpected commit`,
  );
  run(["checkout", "--quiet", "--detach", resolved]);
  return { directory, ref: resolved };
}

export async function installSkill({
  source,
  ref,
  skillPath,
  name,
  directory,
  projectCwd,
}) {
  const options = {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", DISABLE_TELEMETRY: "1" },
    maxBuffer: 8 * 1024 * 1024,
  };
  // Staging is intentionally outside the repository. Resolve its pinned Bun in
  // the checkout first; running mise from the empty stage can select a global Bun.
  const bun = execFileSync("mise", ["which", "bun"], {
    ...options,
    cwd: projectCwd,
  }).trim();
  assert(
    path.isAbsolute(bun),
    "mise did not resolve the project Bun executable",
  );
  const version = execFileSync(
    bun,
    ["x", `skills@${CLI_VERSION}`, "--version"],
    options,
  ).trim();
  assert(version === CLI_VERSION, `Unexpected Skills CLI version: ${version}`);
  execFileSync(
    bun,
    [
      "x",
      `skills@${CLI_VERSION}`,
      "add",
      `https://github.com/${source}/tree/${ref}/${path.posix.dirname(skillPath)}`,
      "--skill",
      name,
      "--agent",
      "codex",
      "--yes",
    ],
    options,
  );
}

function saveSnapshot(sourceDirectory, scratch, name) {
  const directory = path.join(scratch, "expected", name);
  mkdirSync(path.dirname(directory), { recursive: true });
  cpSync(sourceDirectory, directory, { recursive: true });
  return directory;
}

function saveLicenses({
  sourceDirectory,
  paths,
  source,
  name,
  cwd,
  scratch,
  write,
}) {
  const records = [];
  for (const relative of paths) {
    const target =
      name === "github-issues" && relative === "LICENSE"
        ? ISSUE_LICENSE
        : `.agents/licenses/${source.replace("/", "--")}/${relative}`;
    const expected = path.join(
      scratch,
      "licenses",
      source.replace("/", "--"),
      relative,
    );
    mkdirSync(path.dirname(expected), { recursive: true });
    cpSync(path.join(sourceDirectory, relative), expected);
    if (write) {
      cpSync(expected, writablePath(cwd, target));
    }
    records.push({ target, expected });
  }
  return records;
}

function sourceInfo(source, entry) {
  let skillFile;
  try {
    skillFile = plainPath(source.directory, entry.skillPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      `${entry.source}@${source.ref} no longer contains ${entry.skillPath}; review the upstream retirement or move before changing the tracked manifest`,
      { cause: error },
    );
  }
  assert(
    lstatSync(skillFile).isFile(),
    `${entry.skillPath}: expected a regular SKILL.md`,
  );
  const directory = path.dirname(skillFile);
  return {
    directory,
    computedHash: hashDirectory(directory),
    licenseHash: hashLicenses(source.directory, entry.skillPath),
    licenses: licenseFiles(source.directory, entry.skillPath),
  };
}

/** Prepare changes only in an isolated checkout. Fetch/install are injectable so
 * fixture tests do not depend on GitHub or execute downloaded skill programs. */
export async function prepare({
  cwd,
  scratch,
  approvalsPath = ".github/skills-review.json",
  fetchSource: fetch = fetchSource,
  installSkill: install = installSkill,
}) {
  const lock = json(path.join(cwd, "skills-lock.json"));
  assert(
    lock.version === 1 && lock.skills && Object.keys(lock.skills).length,
    "Unsupported or empty skills-lock.json",
  );
  for (const [name, entry] of Object.entries(lock.skills))
    checkEntry(name, entry);
  mkdirSync(scratch, { recursive: true });
  assert(
    readdirSync(scratch).length === 0,
    "Preparation scratch directory must be empty",
  );
  const approvals = existsSync(path.resolve(cwd, approvalsPath))
    ? json(path.resolve(cwd, approvalsPath))
    : null;
  const changes = [];
  const pending = [];
  const verified = [];
  const cache = new Map();
  const acquire = async (source, ref) => {
    const key = `${source}@${ref ?? "HEAD"}`;
    if (!cache.has(key)) {
      const directory = path.join(
        scratch,
        "sources",
        source.replace("/", "--"),
        ref ?? "HEAD",
      );
      const fetched = await fetch({ source, ref, directory });
      assert(
        REF.test(fetched.ref) && (!ref || ref === fetched.ref),
        `${source}: unexpected fetched ref`,
      );
      cache.set(key, fetched);
    }
    return cache.get(key);
  };

  for (const [name, previous] of Object.entries(lock.skills)) {
    try {
      const latest = await acquire(previous.source);
      let selected = latest;
      let info;
      if (name === "github-issues") {
        const approved = approvals?.skills?.[name];
        assert(
          approvals?.version === 1 && approved,
          "Missing github-issues review approval",
        );
        assert(
          approved.source === previous.source &&
            approved.skillPath === previous.skillPath &&
            REF.test(approved.ref) &&
            HASH.test(approved.computedHash) &&
            HASH.test(approved.licenseHash),
          "github-issues review approval does not match the tracked source/path or is incomplete",
        );
        assert(
          REF.test(previous.ref),
          "github-issues requires its existing reviewed full-commit pin",
        );
        selected =
          latest.ref === approved.ref
            ? latest
            : await acquire(previous.source, approved.ref);
        info = sourceInfo(selected, previous);
        assert(
          info.computedHash === approved.computedHash &&
            info.licenseHash === approved.licenseHash,
          "Approved github-issues source or license hash does not match upstream; review the revision before installing",
        );
        if (latest.ref !== approved.ref) {
          let candidate;
          try {
            const latestInfo = sourceInfo(latest, previous);
            candidate = {
              computedHash: latestInfo.computedHash,
              licenseHash: latestInfo.licenseHash,
            };
          } catch (error) {
            candidate = {
              computedHash: null,
              licenseHash: null,
              reason: `Candidate requires manual source inspection: ${error.message}`,
            };
          }
          pending.push({
            name,
            source: previous.source,
            skillPath: previous.skillPath,
            ref: latest.ref,
            ...candidate,
            approvedRef: approved.ref,
          });
        }
      } else info = sourceInfo(latest, previous);
      const changed =
        info.computedHash !== previous.computedHash ||
        (previous.licenseHash !== undefined &&
          info.licenseHash !== previous.licenseHash) ||
        (name === "github-issues" && selected.ref !== previous.ref);
      if (!changed && name !== "github-issues") continue;
      const expected = saveSnapshot(info.directory, scratch, name);
      if (changed) {
        const stage = path.join(scratch, "install", name);
        mkdirSync(stage, { recursive: true });
        await install({
          source: previous.source,
          ref: selected.ref,
          skillPath: previous.skillPath,
          name,
          directory: stage,
          projectCwd: cwd,
        });
        const generated = json(path.join(stage, "skills-lock.json"));
        const installedEntry = generated.skills?.[name];
        assert(
          generated.version === 1 &&
            Object.keys(generated.skills).length === 1 &&
            installedEntry,
          `${name}: installer must produce exactly the selected skill`,
        );
        assert(
          installedEntry.source === previous.source &&
            installedEntry.sourceType === "github" &&
            installedEntry.skillPath === previous.skillPath &&
            installedEntry.ref === selected.ref &&
            installedEntry.computedHash === info.computedHash,
          `${name}: installer lock source, path, revision, or hash mismatch`,
        );
        const installed = plainPath(stage, `.agents/skills/${name}`);
        preserveCliOmissions(installed, expected);
        sameBytes(installed, expected, name);
        const destination = plainPath(cwd, `.agents/skills/${name}`);
        assert(
          existsSync(destination) && !lstatSync(destination).isSymbolicLink(),
          `${name}: tracked skill directory is missing or a symlink`,
        );
        rmSync(destination, { recursive: true });
        cpSync(installed, destination, { recursive: true });
        lock.skills[name] = {
          ...previous,
          ...installedEntry,
          licenseHash: info.licenseHash,
        };
        changes.push({
          name,
          source: previous.source,
          skillPath: previous.skillPath,
          previousRef: previous.ref ?? null,
          previousHash: previous.computedHash,
          previousLicenseHash: previous.licenseHash ?? null,
          ref: selected.ref,
          computedHash: info.computedHash,
          licenseHash: info.licenseHash,
        });
      }
      const licenses = saveLicenses({
        sourceDirectory: selected.directory,
        paths: info.licenses,
        source: previous.source,
        name,
        cwd,
        scratch,
        write: changed,
      });
      verified.push({
        name,
        source: previous.source,
        skillPath: previous.skillPath,
        ref: selected.ref,
        computedHash: info.computedHash,
        licenseHash: lock.skills[name].licenseHash ?? null,
        expected,
        licenses,
      });
    } catch (error) {
      throw new Error(`${name}: source preparation failed: ${error.message}`, {
        cause: error,
      });
    }
  }
  if (changes.length)
    writeFileSync(
      path.join(cwd, "skills-lock.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
    );
  const result = { cliVersion: CLI_VERSION, changes, pending, verified };
  verifySources({ cwd, prepared: result });
  return result;
}

/** Run after hooks and application validation, before committing or publishing. */
export function verifySources({ cwd, prepared }) {
  const lock = json(path.join(cwd, "skills-lock.json"));
  for (const record of prepared.verified) {
    const installed = plainPath(cwd, `.agents/skills/${record.name}`);
    sameBytes(installed, record.expected, record.name);
    const entry = lock.skills?.[record.name];
    assert(
      entry?.source === record.source &&
        entry.sourceType === "github" &&
        entry.skillPath === record.skillPath &&
        entry.ref === record.ref &&
        entry.computedHash === record.computedHash &&
        (entry.licenseHash ?? null) === record.licenseHash &&
        hashDirectory(installed) === record.computedHash,
      `${record.name}: lock or installed hash changed after preparation`,
    );
    for (const license of record.licenses) {
      const actual = plainPath(cwd, license.target);
      assert(
        readFileSync(actual).equals(readFileSync(license.expected)),
        `${record.name}: preserved license bytes differ from upstream: ${license.target}`,
      );
    }
  }
  return { checked: prepared.verified.map(({ name }) => name) };
}
