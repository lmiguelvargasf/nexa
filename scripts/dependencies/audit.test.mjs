import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAudit, parseLock } from "./audit.mjs";

const exception = {
  package: "braces",
  version: "3.0.3",
  severity: "high",
  advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  expires: "2026-10-18T00:00:00Z",
  reason: "Explicit temporary exception",
};
const lock = { packages: { braces: ["braces@3.0.3"] } };
const finding = {
  url: exception.advisory,
  severity: "high",
  title: "Known issue",
  vulnerable_versions: "<=3.0.3",
};
const now = Date.parse("2026-10-03T00:00:00Z");
test("only the exact advisory, severity and every locked version are excepted", () => {
  const evaluate = (a, l = lock) => evaluateAudit(a, l, [exception], now);
  assert.equal(evaluate({ braces: [finding] }).accepted.length, 1);
  assert.equal(
    evaluate({
      braces: [{ ...finding, url: "https://github.com/advisories/GHSA-other" }],
    }).blocked.length,
    1,
  );
  assert.equal(
    evaluate({ braces: [{ ...finding, severity: "critical" }] }).blocked.length,
    1,
  );
  assert.equal(
    evaluate({ braces: [finding] }, { packages: { braces: ["braces@3.0.2"] } })
      .blocked.length,
    1,
  );
  assert.equal(
    evaluate(
      { braces: [finding] },
      { packages: { ...lock.packages, "parent/braces": ["braces@3.0.2"] } },
    ).blocked.length,
    1,
  );
  assert.equal(
    evaluate({
      braces: [
        finding,
        { ...finding, url: "https://github.com/advisories/GHSA-new" },
      ],
    }).blocked.length,
    1,
  );
});
test("expired exceptions and unavailable or malformed audit data fail closed", () => {
  assert.throws(() =>
    evaluateAudit({}, lock, [exception], Date.parse(exception.expires)),
  );
  for (const data of [
    null,
    [],
    "",
    { braces: [] },
    { braces: [{}] },
    { missing: [finding] },
  ])
    assert.throws(() => evaluateAudit(data, lock, [exception], now));
  assert.deepEqual(evaluateAudit({}, lock, [exception], now), {
    accepted: [],
    blocked: [],
  });
});

test("lockfile parsing accepts trailing commas without evaluating code or altering quoted data", () => {
  assert.deepEqual(parseLock('{"quoted": ",}", "packages": {},}'), {
    quoted: ",}",
    packages: {},
  });
  assert.throws(() => parseLock('{"code": (() => process.exit())()}'));
  assert.throws(() => parseLock('{/* comment */ "a": 1}'));
  assert.ok(
    parseLock(readFileSync(new URL("../../bun.lock", import.meta.url), "utf8"))
      .packages,
  );
});
