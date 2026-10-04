import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertIdentity,
  assertValidation,
  databaseApplicable,
  estimateCost,
  helperEligibility,
  lockedChanges,
  parseLock,
  reviewIdentity,
  usageFromEvents,
  validateReview,
} from "./policy.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const tested = "c".repeat(40);
const identity = {
  repository: "owner/template",
  prNumber: 16,
  headSha: head,
  baseSha: base,
  testedSha: tested,
};
const pr = {
  number: 16,
  state: "open",
  draft: false,
  user: { id: 29139614, login: "renovate[bot]", type: "Bot" },
  head: { sha: head, repo: { full_name: "owner/template" } },
  base: { sha: base, repo: { full_name: "owner/template" } },
};
const commit = { sha: tested, parents: [{ sha: base }, { sha: head }] };
const schema = JSON.parse(
  readFileSync(
    new URL("../../.github/dependencies/review-schema.json", import.meta.url),
  ),
);
const result = {
  decision: "PASS",
  headSha: head,
  baseSha: base,
  testedSha: tested,
  summary: "Reviewed",
  findings: [],
  evidence: ["Versioned release notes, usage and CI"],
  uncertainties: [],
};
const entry = (name, version) => [`${name}@${version}`, "", {}, "sha512-YWJj"];
function fixture() {
  const before = {
    scripts: { build: "next build" },
    dependencies: { clsx: "^2.1.0" },
    devDependencies: {},
  };
  const after = { ...before, dependencies: { clsx: "^2.1.1" } };
  const lock = (manifest, version) => ({
    lockfileVersion: 1,
    workspaces: {
      "": {
        name: "app",
        dependencies: manifest.dependencies,
        devDependencies: {},
      },
    },
    packages: {
      clsx: entry("clsx", version),
      transitive: entry("transitive", "1.0.0"),
    },
  });
  return {
    paths: ["package.json", "bun.lock"],
    before,
    after,
    oldLock: lock(before, "2.1.0"),
    newLock: lock(after, "2.1.1"),
  };
}

test("aggregate distinguishes not-applicable database from every missing/failed required result", () => {
  const results = {
    scope: { result: "success" },
    verify: { result: "success" },
    database: { result: "success" },
  };
  assert.doesNotThrow(() => assertValidation(results, true));
  assert.doesNotThrow(() =>
    assertValidation({ ...results, database: { result: "skipped" } }, false),
  );
  for (const name of Object.keys(results)) {
    for (const state of ["failure", "cancelled", "skipped", "", undefined]) {
      assert.throws(() =>
        assertValidation(
          { ...results, [name]: state ? { result: state } : undefined },
          true,
        ),
      );
    }
  }
  assert.throws(() => assertValidation(results, false));
  assert.throws(() =>
    assertValidation({ ...results, database: { result: "failure" } }, false),
  );
});

test("database scope includes dependencies, toolchain, workflow changes and migrations", () => {
  for (const path of [
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "mise.toml",
    ".github/workflows/ci.yml",
    "supabase/migrations/change.sql",
  ])
    assert.equal(databaseApplicable([path]), true);
  assert.equal(databaseApplicable(["README.md", "src/lib/utils.ts"]), false);
});

test("only same-repository Renovate with current tested head/base is trusted", () => {
  assert.doesNotThrow(() =>
    assertIdentity(identity, pr, commit, "owner/template"),
  );
  for (const mutate of [
    (p) => {
      p.user.id = 1;
    },
    (p) => {
      p.user.login = "renovate";
    },
    (p) => {
      p.head.repo.full_name = "fork/template";
    },
    (p) => {
      p.head.sha = "d".repeat(40);
    },
    (p) => {
      p.base.sha = "d".repeat(40);
    },
    (p) => {
      p.state = "closed";
    },
    (p) => {
      p.draft = true;
    },
  ]) {
    const changed = structuredClone(pr);
    mutate(changed);
    assert.throws(() =>
      assertIdentity(identity, changed, commit, "owner/template"),
    );
  }
  assert.throws(() =>
    assertIdentity(
      identity,
      pr,
      { ...commit, parents: [{ sha: head }, { sha: base }] },
      "owner/template",
    ),
  );
  assert.throws(() =>
    assertIdentity(
      identity,
      pr,
      { ...commit, parents: [{ sha: head }] },
      "owner/template",
    ),
  );
});

test("stable helper patches qualify only with consistent source, declarations and isolated lock changes", () => {
  assert.equal(helperEligibility(fixture(), ["clsx"]).candidate, true);
  for (const mutate of [
    (f) => {
      f.paths.push("src/app/page.tsx");
    },
    (f) => {
      f.paths.push(".github/workflows/dependency-review.yml");
    },
    (f) => {
      f.after.overrides = { ws: "9.0.0" };
    },
    (f) => {
      f.after.scripts.build = "unsafe";
      f.before.scripts = { build: "next build" };
    },
    (f) => {
      f.after.trustedDependencies = ["new-install-hook"];
    },
    (f) => {
      f.newLock.packages.transitive = entry("transitive", "1.0.1");
    },
    (f) => {
      f.newLock.workspaces[""].dependencies = { clsx: "^2.1.0" };
    },
    (f) => {
      f.newLock.packages.clsx[2] = { dependencies: { dangerous: "1.0.0" } };
    },
    (f) => {
      f.newLock.packages.clsx[1] = "https://example.com/untrusted.tgz";
    },
    (f) => {
      f.newLock.packages.clsx[3] = "bad-integrity";
    },
    (f) => {
      f.newLock.packages.clsx[0] = "clsx@2.1.9";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(helperEligibility(f, ["clsx"]).candidate, false);
  }
});

test("minor, major, prerelease, 0.x, range changes and grouped protected changes require humans", () => {
  for (const [before, after] of [
    ["^2.1.0", "^2.2.0"],
    ["^2.1.0", "^3.0.0"],
    ["^0.1.0", "^0.1.1"],
    ["^2.1.0", "^2.1.1-beta.1"],
    ["^2.1.0", "~2.1.1"],
    ["^2.1.0", "^2.1.0"],
  ]) {
    const f = fixture();
    f.before.dependencies.clsx = before;
    f.after.dependencies.clsx = after;
    assert.equal(helperEligibility(f, ["clsx"]).candidate, false);
  }
  const f = fixture();
  f.before.dependencies.next = "^16.2.0";
  f.after.dependencies.next = "^16.2.1";
  f.oldLock.packages.next = entry("next", "16.2.0");
  f.newLock.packages.next = entry("next", "16.2.1");
  assert.equal(helperEligibility(f, ["clsx"]).candidate, false);
});

test("Bun trailing commas are parsed as data and quoted text is preserved", () => {
  assert.deepEqual(parseLock('{"quoted": ",}", "packages": {},}'), {
    quoted: ",}",
    packages: {},
  });
  assert.throws(() => parseLock('{"code": (() => process.exit())()}'));
  assert.throws(() => parseLock('{/* comment */ "a": 1}'));
  assert.equal(
    parseLock(readFileSync(new URL("../../bun.lock", import.meta.url), "utf8"))
      .lockfileVersion,
    1,
  );
});

test("release evidence uses resolved lock versions and rejects unsupported sources", () => {
  const change = { name: "clsx", before: "^2.1.0", after: "^2.1.1" };
  const old = { packages: { clsx: entry("clsx", "2.1.1") } };
  const next = { packages: { clsx: entry("clsx", "2.1.2") } };
  assert.equal(lockedChanges([change], old, next)[0].after, "2.1.2");
  assert.equal(lockedChanges([change], old, next)[0].declaredAfter, "^2.1.1");
  assert.throws(() => lockedChanges([change], old, { packages: {} }));
  assert.throws(() =>
    lockedChanges([{ ...change, after: "npm:alias@2.1.2" }], old, next),
  );
  next.packages.clsx[1] = "https://example.com/package.tgz";
  assert.throws(() => lockedChanges([change], old, next));
});

test("review requires valid schema, complete evidence and exact revisions", () => {
  assert.equal(
    validateReview(JSON.stringify(result), schema, identity, true, 8192)
      .decision,
    "PASS",
  );
  for (const text of [
    "",
    "not json",
    "{}",
    JSON.stringify({ ...result, extra: true }),
    JSON.stringify({ ...result, decision: "APPROVED" }),
    JSON.stringify({ ...result, evidence: [] }),
    JSON.stringify({ ...result, headSha: "d".repeat(40) }),
    JSON.stringify({ ...result, baseSha: "d".repeat(40) }),
    JSON.stringify({ ...result, findings: ["Problem"] }),
    JSON.stringify({ ...result, uncertainties: ["Missing notes"] }),
  ]) {
    assert.throws(() => validateReview(text, schema, identity, true, 8192));
  }
  assert.throws(() =>
    validateReview(JSON.stringify(result), schema, identity, false, 8192),
  );
  assert.throws(() =>
    validateReview(JSON.stringify(result), schema, identity, true, 10),
  );
  for (const decision of ["NEEDS_HUMAN", "BLOCK"])
    assert.equal(
      validateReview(
        JSON.stringify({ ...result, decision, findings: ["Requires human"] }),
        schema,
        identity,
        false,
        8192,
      ).decision,
      decision,
    );
});

test("deduplication identity changes with base/head, model, effort or prompt", () => {
  const baseline = { model: "gpt-6.1-sol", effort: "medium" };
  const key = reviewIdentity(identity, baseline, "prompt", schema, "config");
  for (const [id, policy, prompt] of [
    [{ ...identity, headSha: "d".repeat(40) }, baseline, "prompt"],
    [{ ...identity, baseSha: "d".repeat(40) }, baseline, "prompt"],
    [identity, { ...baseline, model: "other" }, "prompt"],
    [identity, { ...baseline, effort: "high" }, "prompt"],
    [identity, baseline, "changed"],
  ])
    assert.notEqual(reviewIdentity(id, policy, prompt, schema, "config"), key);
});

test("usage includes reasoning within output without double charging and missing metrics stay unknown", () => {
  const events = [
    {
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 500,
            output_tokens: 300,
            reasoning_output_tokens: 200,
          },
        },
      },
    },
  ];
  const usage = usageFromEvents(events);
  assert.deepEqual(usage, {
    input: 1000,
    cachedInput: 500,
    output: 300,
    reasoning: 200,
  });
  assert.equal(
    estimateCost(usage, { input: 2, cachedInput: 0.1, output: 10 }),
    0.00405,
  );
  assert.equal(usageFromEvents([]), null);
  assert.equal(estimateCost(null, {}), null);
  assert.equal(
    usageFromEvents([
      { type: "turn.completed", usage: { input_tokens: -1, output_tokens: 1 } },
    ]),
    null,
  );
});
