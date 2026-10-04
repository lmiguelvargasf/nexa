import { execFileSync } from "node:child_process";
import {
  bunEligibility,
  compareVersions,
  parseLock,
  SHA,
  stable,
  version,
} from "./policy.mjs";

const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 4_000_000 }).trim();

// Standard-library TOML parser, fixed program, input on stdin. No PR code runs.
export const parseToml = (text) =>
  JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))",
      ],
      { input: text, encoding: "utf8", maxBuffer: 4_000_000 },
    ),
  );

export function readUpdates(identity) {
  const statuses = git(
    "diff",
    "--name-status",
    `${identity.baseSha}...${identity.headSha}`,
  ).split("\n");
  if (statuses.some((line) => !line.startsWith("M\t")))
    throw new Error("Only existing dependency files may be modified.");
  const paths = statuses.map((line) => line.slice(2));
  const before = {};
  const after = {};
  const required = new Set(paths);
  if (
    paths.some((path) =>
      ["package.json", "bun.lock", "mise.toml", "mise.lock"].includes(path),
    )
  ) {
    required.add("package.json");
    required.add("bun.lock");
  }
  if (paths.some((path) => ["mise.toml", "mise.lock"].includes(path))) {
    required.add("mise.toml");
    required.add("mise.lock");
  }
  for (const path of required) {
    before[path] = git("show", `${identity.baseSha}:${path}`);
    after[path] = git("show", `${identity.headSha}:${path}`);
  }
  return { paths, before, after };
}

const sameMajorIncrease = (before, after, allowEqual = false) => {
  const old = version(before);
  const next = version(after);
  return (
    old &&
    next &&
    !old.operator &&
    !next.operator &&
    old.parts[0] === next.parts[0] &&
    compareVersions(next, old) >= (allowEqual ? 0 : 1)
  );
};

export const toolPlatforms = (entry) => [
  ...Object.values(entry.platforms ?? {}),
  ...Object.entries(entry)
    .filter(([key]) => key.startsWith("platforms."))
    .map(([, value]) => value),
];

function toolSource(name, entry) {
  const sources = toolPlatforms(entry).map(({ url, url_api, checksum }) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(checksum ?? ""))
      throw new Error(`${name}: missing tool checksum.`);
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(`${name}: unsupported tool URL.`);
    if (
      name === "node" &&
      parsed.hostname === "nodejs.org" &&
      parsed.pathname.startsWith(`/dist/v${entry.version}/`)
    ) {
      if (url_api !== undefined)
        throw new Error(`${name}: unsupported tool asset API URL.`);
      return { repository: "nodejs/node", tag: `v${entry.version}` };
    }
    const match =
      /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/releases\/download\/([^/]+)\//.exec(
        parsed.pathname,
      );
    if (
      parsed.hostname !== "github.com" ||
      !match ||
      ![`v${entry.version}`, entry.version, `bun-v${entry.version}`].includes(
        match[2],
      )
    )
      throw new Error(`${name}: unsupported versioned tool source.`);
    if (url_api !== undefined) {
      const prefix = `https://api.github.com/repos/${match[1]}/releases/assets/`;
      const id =
        typeof url_api === "string" && url_api.startsWith(prefix)
          ? url_api.slice(prefix.length)
          : "";
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
        throw new Error(`${name}: unsupported tool asset API URL.`);
    }
    return { repository: match[1], tag: match[2] };
  });
  if (!sources.length || sources.some((source) => !equal(source, sources[0])))
    throw new Error(`${name}: missing or inconsistent platform sources.`);
  return sources[0];
}

function miseChanges(before, after, reasons) {
  const oldConfig = parseToml(before["mise.toml"]);
  const newConfig = parseToml(after["mise.toml"]);
  const oldLock = parseToml(before["mise.lock"]);
  const newLock = parseToml(after["mise.lock"]);
  const changes = [];
  const strippedOld = structuredClone(oldLock);
  const strippedNew = structuredClone(newLock);
  for (const name of new Set([
    ...Object.keys(oldConfig.tools ?? {}),
    ...Object.keys(newConfig.tools ?? {}),
  ])) {
    const old = oldConfig.tools[name];
    const next = newConfig.tools[name];
    if (equal(old, next)) continue;
    if (!sameMajorIncrease(old, next)) {
      reasons.push(
        `${name}: only stable same-major tool minor/patch updates qualify.`,
      );
      continue;
    }
    const oldEntries = oldLock.tools?.[name];
    const nextEntries = newLock.tools?.[name];
    if (
      oldEntries?.length !== 1 ||
      nextEntries?.length !== 1 ||
      oldEntries[0].version !== old ||
      nextEntries[0].version !== next
    ) {
      reasons.push(`${name}: tool lockfile does not match its pin.`);
      continue;
    }
    const oldEntry = oldEntries[0];
    const nextEntry = nextEntries[0];
    const stripEntry = (entry) => {
      const result = structuredClone(entry);
      delete result.version;
      for (const platform of toolPlatforms(result)) {
        delete platform.url;
        delete platform.checksum;
        delete platform.url_api;
      }
      return result;
    };
    if (!equal(stripEntry(oldEntry), stripEntry(nextEntry)))
      reasons.push(
        `${name}: tool backend, platform set or provenance policy changed.`,
      );
    const oldSource = toolSource(name, oldEntry);
    const nextSource = toolSource(name, nextEntry);
    if (oldSource.repository !== nextSource.repository)
      reasons.push(`${name}: upstream tool repository changed.`);
    changes.push({
      manager: "mise",
      name,
      before: old,
      after: next,
      repository: nextSource.repository,
      oldRef: oldSource.tag,
      newRef: nextSource.tag,
      oldEntry,
      newEntry: nextEntry,
    });
    delete strippedOld.tools[name];
    delete strippedNew.tools[name];
  }
  if (!equal(strippedOld, strippedNew))
    reasons.push("Unrelated mise lockfile data changed.");
  delete oldConfig.tools;
  delete newConfig.tools;
  if (!equal(oldConfig, newConfig))
    reasons.push("mise settings or tasks changed.");
  return changes;
}

// Remote `uses` scalars only; matching the rest byte-for-byte prevents changes to
// workflow commands, permissions, expressions, inputs, structure or local calls.
export function actionReferences(text) {
  const references = [];
  const normalized = text.replace(
    /^(\s*(?:-\s*)?uses:\s*)([^\r\n]+)$/gm,
    (line, prefix, value) => {
      const match =
        /^(?:(["']))?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([A-Za-z0-9_.-]+)(?:\1)?\s*(?:#\s*(.*))?$/.exec(
          value,
        );
      if (!match) return line;
      const [, , name, ref, comment = ""] = match;
      const tag = SHA.test(ref)
        ? /^(?:reviewed\s+)?(v\d+(?:\.\d+){0,2})$/.exec(comment)?.[1]
        : ref;
      const numeric = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(tag ?? "");
      const releaseVersion = numeric
        ? `${numeric[1]}.${numeric[2] ?? 0}.${numeric[3] ?? 0}`
        : null;
      references.push({
        name,
        ref,
        tag,
        version: releaseVersion,
        repository: name.split("/").slice(0, 2).join("/"),
        // Keep non-version annotations unchanged, e.g. `# reviewed v1`.
        annotation: comment.replace(/v\d+(?:\.\d+){0,2}$/, "").trim(),
      });
      return `${prefix}DEPENDENCY_REFERENCE`;
    },
  );
  return { normalized, references };
}

function actionChanges(path, before, after, reasons) {
  const old = actionReferences(before);
  const next = actionReferences(after);
  if (
    old.normalized !== next.normalized ||
    old.references.length !== next.references.length
  )
    reasons.push(`${path}: workflow behavior or structure changed.`);
  const changes = [];
  for (let i = 0; i < old.references.length; i++) {
    const a = old.references[i];
    const b = next.references[i];
    if (equal(a, b)) continue;
    if (
      !b ||
      a.name !== b.name ||
      a.annotation !== b.annotation ||
      !sameMajorIncrease(a.version, b.version, true) ||
      (a.ref === b.ref && a.tag === b.tag)
    ) {
      reasons.push(
        `${path}: only stable same-major Action version/digest updates qualify.`,
      );
      continue;
    }
    changes.push({
      manager: "github-actions",
      name: b.name,
      before: a.version,
      after: b.version,
      repository: b.repository,
      oldRef: a.ref,
      newRef: b.ref,
      oldTag: a.tag,
      newTag: b.tag,
      path,
    });
  }
  return changes;
}

function runtimeDeclarations(before, after, tools, reasons) {
  const old = {
    packageManager: before.packageManager,
    engines: before.engines,
  };
  const next = { packageManager: after.packageManager, engines: after.engines };
  const expected = structuredClone(old);
  for (const tool of tools) {
    if (tool.name === "bun") {
      if (expected.packageManager === `bun@${tool.before}`)
        expected.packageManager = `bun@${tool.after}`;
      if (expected.engines?.bun === `>=${tool.before}`)
        expected.engines.bun = `>=${tool.after}`;
    }
    if (
      tool.name === "node" &&
      expected.engines?.node ===
        `>=${tool.before} <${version(tool.before).parts[0] + 1}`
    )
      expected.engines.node = `>=${tool.after} <${version(tool.after).parts[0] + 1}`;
  }
  if (!equal(expected, next))
    reasons.push(
      "Runtime manifest declarations must track the corresponding mise update.",
    );
}

export function inspectUpdates(snapshot) {
  const { paths, before, after } = snapshot;
  const reasons = [];
  let changes = [];
  for (const path of paths)
    if (
      !["package.json", "bun.lock", "mise.toml", "mise.lock"].includes(path) &&
      !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(path)
    )
      reasons.push(`${path}: unrelated file change requires human review.`);
  try {
    if (paths.some((path) => ["package.json", "bun.lock"].includes(path))) {
      const result = bunEligibility({
        paths: paths.filter((path) =>
          ["package.json", "bun.lock"].includes(path),
        ),
        before: JSON.parse(before["package.json"]),
        after: JSON.parse(after["package.json"]),
        oldLock: parseLock(before["bun.lock"]),
        newLock: parseLock(after["bun.lock"]),
      });
      reasons.push(...result.reasons);
      changes.push(...result.changes);
    }
    const tools = paths.some((path) =>
      ["mise.toml", "mise.lock"].includes(path),
    )
      ? miseChanges(before, after, reasons)
      : [];
    changes.push(...tools);
    if (before["package.json"])
      runtimeDeclarations(
        JSON.parse(before["package.json"]),
        JSON.parse(after["package.json"]),
        tools,
        reasons,
      );
    for (const path of paths.filter((path) =>
      path.startsWith(".github/workflows/"),
    ))
      changes.push(...actionChanges(path, before[path], after[path], reasons));
  } catch (error) {
    reasons.push(`Unsupported dependency data: ${error.message}`);
  }
  // Repeated Action references and dependency/override declarations need one
  // upstream review per actual version transition, without hiding their diff.
  changes = [
    ...new Map(
      changes.map((change) => [
        JSON.stringify([
          change.manager,
          change.name,
          change.before,
          change.after,
          change.newRef,
        ]),
        change,
      ]),
    ).values(),
  ];
  if (!changes.length)
    reasons.push("No declared dependency minor/patch or Action pin update.");
  return { candidate: reasons.length === 0, reasons, changes };
}
