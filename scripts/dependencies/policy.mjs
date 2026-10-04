import { createHash } from "node:crypto";

export const SHA = /^[a-f0-9]{40}$/;
export const RENOVATE_ID = 29139614;
export const DATABASE_PATHS = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "mise.toml",
  "mise.lock",
  "Taskfile.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/database.yml",
];

export function databaseApplicable(paths) {
  return paths.some(
    (path) => DATABASE_PATHS.includes(path) || path.startsWith("supabase/"),
  );
}

export function assertValidation(results, databaseRequired) {
  for (const name of ["scope", "verify", "database"]) {
    const expected =
      name === "database" && !databaseRequired ? "skipped" : "success";
    if (results[name]?.result !== expected) {
      throw new Error(
        `${name}: expected ${expected}, received ${results[name]?.result ?? "missing"}`,
      );
    }
  }
}

export function assertIdentity(
  identity,
  pr,
  commit,
  repository,
  renovateOnly = true,
) {
  if (
    pr.state !== "open" ||
    pr.draft ||
    !pr.head.repo?.full_name ||
    pr.base.repo?.full_name !== repository ||
    (renovateOnly &&
      (pr.head.repo?.full_name !== repository ||
        pr.user.id !== RENOVATE_ID ||
        pr.user.login !== "renovate[bot]" ||
        pr.user.type !== "Bot"))
  ) {
    throw new Error(
      "Only open, same-repository Renovate PRs can enter the reviewer.",
    );
  }
  for (const key of ["headSha", "baseSha", "testedSha"]) {
    if (!SHA.test(identity[key])) throw new Error(`Invalid ${key}`);
  }
  if (
    identity.repository !== repository ||
    identity.prNumber !== pr.number ||
    identity.headSha !== pr.head.sha ||
    identity.baseSha !== pr.base.sha ||
    commit.sha !== identity.testedSha ||
    commit.parents?.length !== 2 ||
    commit.parents[0].sha !== identity.baseSha ||
    commit.parents[1].sha !== identity.headSha
  ) {
    throw new Error(
      "Stale or unrelated tested merge revision; update the branch and rerun CI.",
    );
  }
}

// Bun's text lockfile is JSON with trailing commas, not executable JavaScript.
// Preserve quoted strings while removing trailing commas; reject comments.
export function parseLock(text) {
  return JSON.parse(
    text.replace(
      /("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g,
      (_match, string) => string ?? "",
    ),
  );
}

// A recursively sorted representation also handles nested dependency metadata.
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function dependencyChanges(before, after) {
  const changes = [];
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const old = before[section] ?? {};
    const next = after[section] ?? {};
    for (const name of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (old[name] !== next[name])
        changes.push({
          name,
          section,
          before: old[name] ?? null,
          after: next[name] ?? null,
        });
    }
  }
  return changes;
}

export function lockedChanges(changes, oldLock, newLock) {
  return changes.map((change) => {
    const resolved = (lock, declaration) => {
      if (
        !/^(?:\^|~)?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(declaration ?? "")
      )
        throw new Error(`${change.name}: unsupported dependency declaration`);
      const entry = lock?.packages?.[change.name];
      const prefix = `${change.name}@`;
      if (
        !Array.isArray(entry) ||
        !entry[0]?.startsWith(prefix) ||
        entry[1] !== ""
      )
        throw new Error(`${change.name}: unsupported locked package source`);
      const value = entry[0].slice(prefix.length);
      if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value))
        throw new Error(`${change.name}: unsupported locked version`);
      return value;
    };
    return {
      ...change,
      declaredBefore: change.before,
      declaredAfter: change.after,
      before: resolved(oldLock, change.before),
      after: resolved(newLock, change.after),
    };
  });
}

// Deliberately support only simple stable exact/caret/tilde declarations.
const version = (value) => {
  if (typeof value !== "string") return null;
  const match = /^(\^|~)?([1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const parts = match.slice(2).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return { operator: match[1] ?? "", parts };
};
const compareVersions = (a, b) =>
  a.parts
    .map((part, index) => part - b.parts[index])
    .find((diff) => diff !== 0) ?? 0;
const satisfies = (resolved, declaration) => {
  if (resolved.parts[0] !== declaration.parts[0]) return false;
  const comparison = compareVersions(resolved, declaration);
  if (comparison < 0) return false;
  if (declaration.operator === "^") return true;
  if (declaration.operator === "~")
    return resolved.parts[1] === declaration.parts[1];
  return comparison === 0;
};

export function helperEligibility(
  { paths, before, after, oldLock, newLock },
  allowlist,
) {
  const reasons = [];
  const changes = dependencyChanges(before, after);
  if (
    paths.length !== 2 ||
    !paths.includes("package.json") ||
    !paths.includes("bun.lock")
  ) {
    reasons.push("Only package.json and bun.lock may change.");
  }
  const strip = (manifest) => {
    const result = structuredClone(manifest);
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ])
      delete result[section];
    return result;
  };
  if (!equal(strip(before), strip(after)))
    reasons.push("Manifest policy, overrides, scripts, or toolchain changed.");
  if (!changes.length) reasons.push("No direct helper update.");
  for (const change of changes) {
    const old = version(change.before);
    const next = version(change.after);
    if (
      !["dependencies", "devDependencies"].includes(change.section) ||
      !allowlist.includes(change.name) ||
      !old ||
      !next ||
      old.operator !== next.operator ||
      old.parts[0] !== next.parts[0] ||
      compareVersions(next, old) <= 0
    ) {
      reasons.push(
        `${change.name}: requires human review (only stable helper minor/patch updates qualify).`,
      );
    }
  }
  const changedNames = changes.map(({ name }) => name);
  if (
    !equal(oldLock?.workspaces?.[""]?.dependencies, before.dependencies) ||
    !equal(newLock?.workspaces?.[""]?.dependencies, after.dependencies) ||
    !equal(
      oldLock?.workspaces?.[""]?.devDependencies,
      before.devDependencies,
    ) ||
    !equal(newLock?.workspaces?.[""]?.devDependencies, after.devDependencies)
  ) {
    reasons.push("Lockfile workspace declarations are inconsistent.");
  }
  const stripLock = (lock) => {
    const result = structuredClone(lock ?? {});
    delete result.workspaces?.[""]?.dependencies;
    delete result.workspaces?.[""]?.devDependencies;
    for (const name of changedNames) delete result.packages?.[name];
    return result;
  };
  if (!equal(stripLock(oldLock), stripLock(newLock)))
    reasons.push("Unrelated or transitive lockfile metadata changed.");
  for (const change of changes) {
    const resolved = [];
    for (const [lock, declaration] of [
      [oldLock, change.before],
      [newLock, change.after],
    ]) {
      const entry = lock?.packages?.[change.name];
      const parsed = version(declaration);
      const prefix = `${change.name}@`;
      if (
        !Array.isArray(entry) ||
        entry.length !== 4 ||
        typeof entry[0] !== "string" ||
        !entry[0].startsWith(prefix) ||
        entry[1] !== "" ||
        !equal(entry[2], {}) ||
        typeof entry[3] !== "string" ||
        !/^sha512-[A-Za-z0-9+/=]+$/.test(entry[3])
      ) {
        reasons.push(
          `${change.name}: unsupported source, integrity, or dependency metadata.`,
        );
        continue;
      }
      const locked = version(entry[0].slice(prefix.length));
      if (!locked || locked.operator || !parsed || !satisfies(locked, parsed)) {
        reasons.push(
          `${change.name}: locked version does not satisfy its supported stable declaration.`,
        );
        continue;
      }
      resolved.push(locked);
    }
    if (resolved.length === 2) {
      const comparison = compareVersions(resolved[1], resolved[0]);
      if (resolved[0].parts[0] !== resolved[1].parts[0] || comparison < 0)
        reasons.push(`${change.name}: resolved major change or downgrade.`);
      if (
        comparison === 0 &&
        !equal(oldLock.packages[change.name], newLock.packages[change.name])
      )
        reasons.push(
          `${change.name}: same-version locked package data changed.`,
        );
    }
  }
  return { candidate: reasons.length === 0, reasons, changes };
}

export function reviewIdentity(identity, policy, prompt, schema, config) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          repository: identity.repository,
          prNumber: identity.prNumber,
          headSha: identity.headSha,
          baseSha: identity.baseSha,
          testedSha: identity.testedSha,
          policy,
          prompt,
          schema,
          config,
        }),
      ),
    )
    .digest("hex");
}

function validate(value, schema) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected object");
    if (
      schema.required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))
    )
      throw new Error("Missing or extra review fields");
    for (const [key, child] of Object.entries(schema.properties))
      validate(value[key], child);
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > schema.maxItems
    )
      throw new Error("Invalid array");
    for (const item of value) validate(item, schema.items);
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Infinity) ||
      (schema.enum && !schema.enum.includes(value)) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      throw new Error("Invalid string");
  } else throw new Error("Unsupported schema type");
}

export function validateReview(text, schema, identity, complete, maxBytes) {
  if (Buffer.byteLength(text) > maxBytes)
    throw new Error("Oversized reviewer result");
  const result = JSON.parse(text);
  validate(result, schema);
  for (const key of ["headSha", "baseSha", "testedSha"]) {
    if (result[key] !== identity[key])
      throw new Error(`Reviewer returned stale ${key}`);
  }
  if (
    result.decision === "PASS" &&
    (!complete || result.findings.length || result.uncertainties.length)
  ) {
    throw new Error(
      "PASS requires complete evidence without findings or uncertainties",
    );
  }
  return result;
}

export function usageFromEvents(events) {
  let usage = null;
  for (const event of events) {
    const total =
      event.payload?.type === "token_count"
        ? event.payload.info?.total_token_usage
        : event.type === "turn.completed"
          ? event.usage
          : null;
    if (total) usage = total;
  }
  if (
    !usage ||
    !["input_tokens", "output_tokens"].every(
      (key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0,
    )
  )
    return null;
  const cached = usage.cached_input_tokens ?? 0;
  const reasoning = usage.reasoning_output_tokens ?? 0;
  if (
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    cached > usage.input_tokens ||
    !Number.isSafeInteger(reasoning) ||
    reasoning < 0 ||
    reasoning > usage.output_tokens
  )
    return null;
  return {
    input: usage.input_tokens,
    cachedInput: cached,
    output: usage.output_tokens,
    reasoning,
  };
}

export function estimateCost(usage, prices) {
  return usage
    ? ((usage.input - usage.cachedInput) * prices.input +
        usage.cachedInput * prices.cachedInput +
        usage.output * prices.output) /
        1_000_000
    : null;
}
