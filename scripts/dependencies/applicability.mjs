import { execFileSync } from "node:child_process";
import { SHA, stable } from "./policy.mjs";
import { parseToml } from "./updates.mjs";

const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const manifestFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "overrides",
  "resolutions",
  "patchedDependencies",
  "bundledDependencies",
  "bundleDependencies",
  "packageManager",
  "engines",
  "devEngines",
  "workspaces",
  "catalog",
  "catalogs",
  "trustedDependencies",
  "ignoreScripts",
  "installConfig",
  "os",
  "cpu",
  "libc",
];
const kind = (path) => {
  if (/(^|\/)package\.json$/.test(path)) return "manifest";
  if (/(^|\/)bun\.lockb?$/.test(path)) return "lock";
  if (/(^|\/)bunfig\.toml$/.test(path)) return "bunfig";
  if (/(^|\/)mise\.lock$/.test(path)) return "lock";
  if (path === ".github/workflows/actions.lock") return "lock";
  // Patches alter installed dependency contents even with unchanged versions.
  if (/(^|\/)patches\//.test(path) || /\.patch$/.test(path)) return "lock";
  if (/(^|\/)\.?mise(?:\.[A-Za-z0-9_-]+)?\.toml$/.test(path)) return "mise";
  if (
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ||
    /(^|\/)action\.ya?ml$/.test(path)
  )
    return "actions";
  return null;
};

function object(text, parser = JSON.parse) {
  const value = parser(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a configuration object.");
  return value;
}

// A deliberately bounded YAML reader: ordinary block mappings/sequences and
// single-line scalars are supported, including quoted keys. Unsupported YAML
// requires conservative dependency review, never an empty set of dependencies. Block strings
// are skipped so a shell script or embedded YAML cannot invent Action pins.
const dependencyScalar = (key) =>
  [
    "container",
    "image",
    "runs-on",
    "using",
    "version",
    "versionSpec",
    "runtime",
    "sdk",
  ].includes(key) || /(?:^|[-_])version(?:$|[-_])/.test(key);

function actionPins(text) {
  const references = [];
  const runtimeReferences = new Set();
  const parents = [];
  let blockIndent = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = /^ */.exec(raw)[0].length;
    if (blockIndent !== null && indent > blockIndent) continue;
    blockIndent = null;
    if (/^ *\t/.test(raw))
      throw new Error("YAML tab indentation is unsupported.");
    let line = raw.slice(indent);
    if (line === "---" || line === "...") continue;
    let sequenceIndent = 0;
    if (/^-\s/.test(line)) {
      sequenceIndent = /^- +/.exec(line)?.[0].length ?? 0;
      if (!sequenceIndent) throw new Error("Unsupported YAML sequence.");
      line = line.slice(sequenceIndent);
    }
    if (!line || /^[&*!?%[{]/.test(line))
      throw new Error("Unsupported YAML structure or alias.");
    const match =
      /^("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s:'"{},[\]]+):(?:\s+(.*)|$)/.exec(
        line,
      );
    if (!match) {
      // Plain scalar sequence entries (e.g. triggers/paths) cannot contain uses
      // keys; reject other continuation/complex mapping forms conservatively.
      if (sequenceIndent && !/[[\]{}:&*!]/.test(line)) {
        while (parents.length && parents.at(-1).indent > indent) parents.pop();
        const parent = parents.at(-1);
        if (parent && dependencyScalar(parent.key)) {
          const scalar = line.replace(/(?:^|\s+)#.*$/, "").trim();
          const decoded = scalar.startsWith('"')
            ? JSON.parse(scalar)
            : scalar.startsWith("'")
              ? scalar.slice(1, -1).replaceAll("''", "'")
              : scalar;
          runtimeReferences.add(`${parent.key}:${decoded}`);
        }
        continue;
      }
      throw new Error("Unsupported YAML mapping or multiline scalar.");
    }
    const decode = (value) => {
      if (value.startsWith('"')) return JSON.parse(value);
      if (value.startsWith("'"))
        return value.slice(1, -1).replaceAll("''", "'");
      return value;
    };
    const key = decode(match[1]);
    while (parents.length && parents.at(-1).indent >= indent) parents.pop();
    parents.push({ key, indent: indent + sequenceIndent });
    const value = (match[2] ?? "").trim();
    if (dependencyScalar(key) && value.includes("$" + "{{"))
      throw new Error(
        "Dynamic dependency references require conservative review.",
      );
    if (
      /^[|>][1-9]?[+-]?(?:\s*#.*)?$/.test(value) ||
      /^[|>][+-][1-9](?:\s*#.*)?$/.test(value)
    ) {
      if (key === "uses" || dependencyScalar(key))
        throw new Error("Block dependency references are unsupported.");
      blockIndent = indent + sequenceIndent;
      continue;
    }
    if (value.startsWith("[")) {
      // Trigger, needs and path lists are common; only scalar entries are safe
      // here. Collections containing mappings/aliases require a full parser.
      const list =
        /^\[(?:\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s,[\]{}:&*!?%][^,[\]{}:&*!?%]*?)\s*(?:,\s*|(?=\])))*\](?:\s+#.*)?$/.test(
          value,
        );
      if (key === "uses" || !list)
        throw new Error("Unsupported YAML flow collection.");
      if (dependencyScalar(key)) {
        const entries =
          value
            .slice(1, value.lastIndexOf("]"))
            .match(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,\s][^,]*/g) ?? [];
        for (const entry of entries)
          runtimeReferences.add(`${key}:${decode(entry.trim())}`);
      }
      continue;
    }
    if (/^[&*!?%{]/.test(value) || key === "<<")
      throw new Error("Unsupported YAML flow collection, tag or alias.");
    let scalar = value;
    if (/^["']/.test(value)) {
      const quoted = /^("(?:\\.|[^"\\])*"|'(?:''|[^'])*')(?:\s+#.*)?$/.exec(
        value,
      );
      if (!quoted) throw new Error("Unsupported YAML quoted scalar.");
      scalar = decode(quoted[1]);
    } else {
      scalar = value.replace(/(?:^|\s+)#.*$/, "").trim();
    }
    if (key !== "uses") {
      // Version/runtime inputs are dependency declarations even when the
      // Action pin is unchanged. Other `with` options and shell commands are
      // ordinary workflow behavior. Empty container mappings use image below.
      if (dependencyScalar(key) && scalar)
        runtimeReferences.add(`${key}:${scalar}`);
      continue;
    }
    if (/^\.\//.test(scalar)) continue;
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[^\s]+$/.test(
        scalar,
      ) &&
      !/^docker:\/\/[^\s]+$/.test(scalar)
    )
      throw new Error("Unsupported or missing remote Action reference.");
    references.push(scalar);
  }
  // Repeated jobs using the same runtime do not introduce a new dependency.
  // Remote Action additions/removals still count, including duplicate calls.
  return [...references, ...runtimeReferences].sort();
}

export function inspectApplicability({ paths, before, after }) {
  if (
    !Array.isArray(paths) ||
    paths.some(
      (path) => typeof path !== "string" || !path || path.includes("\0"),
    ) ||
    new Set(paths).size !== paths.length ||
    !before ||
    !after
  )
    throw new Error("Missing or invalid changed-file evidence.");
  const reasons = [];
  for (const path of paths) {
    const type = kind(path);
    if (!type) continue;
    for (const side of [before, after])
      if (
        !Object.hasOwn(side, path) ||
        (side[path] !== null && typeof side[path] !== "string")
      )
        throw new Error(`${path}: missing or unreadable file evidence.`);
    const oldText = before[path];
    const newText = after[path];
    if (oldText === null && newText === null)
      throw new Error(`${path}: file is absent from both revisions.`);
    if (oldText === newText) continue;
    try {
      let changed;
      if (type === "lock") changed = true;
      else if (type === "manifest") {
        const old = oldText === null ? {} : object(oldText);
        const next = newText === null ? {} : object(newText);
        changed = manifestFields.some(
          (field) => !equal(old[field], next[field]),
        );
      } else if (type === "actions") {
        changed = !equal(actionPins(oldText ?? ""), actionPins(newText ?? ""));
      } else {
        const old = oldText === null ? {} : object(oldText, parseToml);
        const next = newText === null ? {} : object(newText, parseToml);
        const fields = type === "mise" ? ["tools", "plugins"] : ["install"];
        changed = fields.some((field) => !equal(old[field], next[field]));
        if (type === "mise")
          changed ||= ["lockfile", "lockfile_platforms"].some(
            (field) => !equal(old.settings?.[field], next.settings?.[field]),
          );
      }
      if (changed)
        reasons.push(
          `${path}: dependency declarations, resolutions or install policy changed.`,
        );
    } catch (error) {
      if (type === "actions") {
        // The complete blob is present but beyond this bounded reader. Keep
        // manual completion available while refusing an applicability bypass.
        reasons.push(
          `${path}: unsupported YAML requires conservative dependency review (${error.message}).`,
        );
      } else {
        throw new Error(
          `${path}: cannot classify dependency evidence: ${error.message}`,
          { cause: error },
        );
      }
    }
  }
  return { applicable: reasons.length > 0, reasons };
}

// Read trusted Git objects only. No checkout, PR scripts, dependency install,
// external diff driver, text conversion, or API file-list truncation is involved.
export function readApplicability(identity, { cwd } = {}) {
  for (const key of ["baseSha", "headSha"])
    if (!SHA.test(identity?.[key] ?? "")) throw new Error(`Invalid ${key}.`);
  const gitBytes = (...args) =>
    execFileSync(
      "git",
      ["--no-replace-objects", "--literal-pathspecs", ...args],
      {
        cwd,
        maxBuffer: 16_000_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const git = (...args) =>
    new TextDecoder("utf-8", { fatal: true }).decode(gitBytes(...args));
  if (git("rev-parse", "--is-shallow-repository").trim() !== "false")
    throw new Error(
      "Complete Git history is required to classify the PR diff.",
    );
  for (const key of ["baseSha", "headSha"])
    if (git("cat-file", "-t", identity[key]).trim() !== "commit")
      throw new Error(`${key} is not a commit.`);
  const bases = git("merge-base", "--all", identity.baseSha, identity.headSha)
    .trim()
    .split("\n");
  if (bases.length !== 1 || !SHA.test(bases[0]))
    throw new Error("The PR diff has no unique merge base.");
  const diff = git(
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--name-status",
    "-z",
    bases[0],
    identity.headSha,
    "--",
  );
  if (diff && !diff.endsWith("\0"))
    throw new Error("Incomplete changed-file evidence.");
  const fields = diff ? diff.slice(0, -1).split("\0") : [];
  if (fields.length % 2) throw new Error("Malformed changed-file evidence.");
  const snapshot = { paths: [], before: {}, after: {} };
  const blob = (sha, path) => {
    const entry = git("ls-tree", "-z", sha, "--", path);
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(
      entry,
    );
    if (!match || match[3] !== path)
      throw new Error(`${path}: expected a readable regular file.`);
    return kind(path) === "lock"
      ? gitBytes("cat-file", "blob", match[2]).toString("base64")
      : git("cat-file", "blob", match[2]);
  };
  for (let i = 0; i < fields.length; i += 2) {
    const [status, path] = fields.slice(i, i + 2);
    if (!/^[AMDT]$/.test(status) || !path)
      throw new Error("Unsupported changed-file status.");
    snapshot.paths.push(path);
    if (!kind(path)) continue;
    snapshot.before[path] = status === "A" ? null : blob(bases[0], path);
    snapshot.after[path] = status === "D" ? null : blob(identity.headSha, path);
  }
  return inspectApplicability(snapshot);
}

// Trusted workflow checkouts are commonly shallow. Fetch objects/ancestry only;
// the checkout and executable policy stay on the default branch.
export function fetchApplicability(identity, { cwd } = {}) {
  for (const key of ["baseSha", "headSha"])
    if (!SHA.test(identity?.[key] ?? "")) throw new Error(`Invalid ${key}.`);
  const options = { cwd, encoding: "utf8", maxBuffer: 16_000_000 };
  const shallow = execFileSync(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    options,
  ).trim();
  if (!["true", "false"].includes(shallow))
    throw new Error("Cannot determine Git history completeness.");
  execFileSync(
    "git",
    [
      "fetch",
      "--quiet",
      "--no-tags",
      ...(shallow === "true" ? ["--unshallow"] : []),
      "origin",
      identity.headSha,
      identity.baseSha,
    ],
    options,
  );
  return readApplicability(identity, { cwd });
}
