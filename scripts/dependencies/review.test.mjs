import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectUsage, finish, summary } from "./review.mjs";

const identity = {
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  testedSha: "c".repeat(40),
  repository: "owner/template",
  prNumber: 1,
};
const policy = JSON.parse(
  readFileSync(
    new URL("../../.github/dependencies/policy.json", import.meta.url),
  ),
);
function withReport(callback, automatic = false) {
  const directory = mkdtempSync(join(tmpdir(), "nexa-review-test-"));
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify({
      key: "key",
      runId: 1,
      identity,
      policy: {
        ...policy,
        mode: automatic ? "automatic" : "supervised",
        automaticMerging: automatic,
      },
      status: "PENDING",
      complete: true,
    }),
  );
  try {
    callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("missing credentials/API error, timeout and cancellation never become PASS", () => {
  for (const automatic of [false, true])
    for (const outcome of ["failure", "cancelled", "skipped", undefined])
      withReport((directory) => {
        const report = finish(directory, outcome);
        assert.equal(report.status, "ERROR");
        assert.match(report.reason, /No automatic retry/);
        assert.match(
          readFileSync(join(directory, "summary.md"), "utf8"),
          automatic
            ? /Only the trusted merge policy can authorize/
            : /automatic merging is disabled/,
        );
        assert.equal(report.cost, null);
      }, automatic);
});

test("successful process with missing or malformed output is an error", () => {
  for (const text of [
    null,
    "{}",
    "invalid",
    JSON.stringify({ decision: "PASS" }),
  ])
    withReport((directory) => {
      if (text !== null) writeFileSync(join(directory, "result.json"), text);
      assert.equal(finish(directory, "success").status, "ERROR");
    });
});

test("structured decisions preserve the independent merge gate in both modes", () => {
  for (const automatic of [false, true])
    for (const decision of ["PASS", "NEEDS_HUMAN", "BLOCK"])
      withReport((directory) => {
        writeFileSync(
          join(directory, "result.json"),
          JSON.stringify({
            ...identity,
            repository: undefined,
            prNumber: undefined,
            decision,
            summary: "Checked <script> evidence",
            findings: [],
            evidence: ["bundle release"],
            uncertainties: [],
          }),
        );
        const report = finish(directory, "success");
        assert.equal(report.status, decision);
        assert.match(summary(report), /effort: `medium`/);
        assert.doesNotMatch(summary(report), /<script>/);
        assert.match(
          summary(report),
          automatic
            ? /Only the trusted merge policy can authorize/
            : /AI output never authorizes a merge/,
        );
      }, automatic);
});

test("numeric usage is extracted without exposing session contents", () =>
  withReport((directory) => {
    const home = join(directory, "codex-home");
    mkdirSync(join(home, "sessions"), { recursive: true });
    writeFileSync(
      join(home, "sessions", "session.jsonl"),
      [
        JSON.stringify({
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 10,
                output_tokens: 20,
                reasoning_output_tokens: 15,
              },
            },
          },
        }),
        JSON.stringify({
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 200,
                cached_input_tokens: 20,
                output_tokens: 40,
                reasoning_output_tokens: 30,
              },
            },
          },
        }),
        JSON.stringify({
          payload: { type: "message", text: "SESSION_CONTENT_MUST_NOT_APPEAR" },
        }),
      ].join("\n"),
    );
    assert.deepEqual(collectUsage(home), {
      input: 200,
      cachedInput: 20,
      output: 40,
      reasoning: 30,
    });
    const report = finish(directory, "failure");
    assert.equal(report.cost, 0.000762);
    assert.doesNotMatch(
      JSON.stringify(report),
      /SESSION_CONTENT_MUST_NOT_APPEAR/,
    );
  }));
