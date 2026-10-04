import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ciTarget,
  eventTargets,
  latestAttempts,
  REVIEW_WORKFLOW,
  reviewTarget,
} from "./run-targets.mjs";

const repository = "owner/repo";
const branch = "main";
const sha = "a".repeat(40);
const pr = {
  number: 7,
  state: "open",
  head: { sha, ref: "renovate/clsx", repo: { full_name: repository } },
  base: { ref: branch, repo: { full_name: repository } },
  merge_commit_sha: "b".repeat(40),
};
const ci = {
  id: 123,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  head_repository: { full_name: repository },
  head_branch: pr.head.ref,
  head_sha: sha,
  pull_requests: [{ number: 7 }],
};
const review = {
  id: 222,
  path: REVIEW_WORKFLOW,
  event: "workflow_run",
  head_sha: "c".repeat(40),
  head_branch: branch,
  head_repository: { full_name: repository },
  display_title: "Dependency review CI 123 PR 7",
};
function client({ run = ci, prs = [pr] } = {}) {
  const calls = [];
  return {
    calls,
    api: async (path) => {
      calls.push(path);
      if (path === "actions/runs/123") return run;
      if (path === "actions/runs/222") return review;
      if (path === "pulls/7") return prs[0];
      throw new Error(`Unexpected call ${path}`);
    },
    pages: async (path) => {
      calls.push(path);
      return prs;
    },
  };
}

test("workflow events refetch API identity and target one PR without artifact or backlog lookup", async () => {
  for (const run of [ci, review]) {
    const c = client();
    const targets = await eventTargets(
      c,
      repository,
      branch,
      { GITHUB_EVENT_NAME: "workflow_run" },
      {
        workflow_run: {
          id: run.id,
          pull_requests: [{ number: 99 }],
          head_branch: "forged",
        },
      },
    );
    assert.deepEqual(targets, [7]);
    assert.ok(
      !c.calls.some(
        (path) => path.includes("artifacts") || path.startsWith("pulls?"),
      ),
    );
  }
});

test("CI branch fallback validates repository, branch and current revision", async () => {
  const run = { ...ci, pull_requests: [] };
  const c = client({ run });
  assert.equal(await ciTarget(c, run, repository, branch), 7);
  assert.match(c.calls[0], /head=owner%3Arenovate%2Fclsx/);
  for (const change of [
    { head_sha: "f".repeat(40) },
    { path: ".github/workflows/forged.yml" },
    { head_repository: { full_name: "attacker/fork" } },
    { head_branch: "forged" },
    { pull_requests: [{ number: 7 }, { number: 8 }] },
  ])
    await assert.rejects(
      ciTarget(client(), { ...run, ...change }, repository, branch),
    );
  for (const prs of [[], [pr, { ...pr, number: 8 }]])
    await assert.rejects(ciTarget(client({ prs }), run, repository, branch));
});

test("fork CI associates through GitHub repository identity without PR artifact trust", async () => {
  const fork = {
    ...pr,
    head: { ...pr.head, repo: { full_name: "contributor/fork" } },
  };
  const run = { ...ci, head_repository: { full_name: "contributor/fork" } };
  assert.equal(
    await ciTarget(client({ prs: [fork] }), run, repository, branch),
    7,
  );
});

test("main CI produces no PR scan and unsupported event identities fail explicitly", async () => {
  const run = { ...ci, event: "push", head_branch: branch, pull_requests: [] };
  const c = client({ run });
  assert.deepEqual(
    await eventTargets(
      c,
      repository,
      branch,
      { GITHUB_EVENT_NAME: "workflow_run" },
      { workflow_run: { id: 123 } },
    ),
    [],
  );
  assert.deepEqual(c.calls, ["actions/runs/123"]);
  await assert.rejects(
    ciTarget(c, { ...run, head_branch: "other" }, repository, branch),
  );
});

test("review association rejects invalid provenance and mismatched markers", async () => {
  for (const change of [
    { event: "pull_request" },
    { head_branch: "other" },
    { head_repository: { full_name: "attacker/fork" } },
    { path: "forged" },
    { head_sha: "invalid" },
    { display_title: "Dependency review PR 7" },
  ])
    await assert.rejects(
      reviewTarget(client(), { ...review, ...change }, repository, branch),
    );
  const c = client({ run: { ...ci, id: 999 } });
  await assert.rejects(
    reviewTarget(c, review, repository, branch),
    /identity mismatch/,
  );
  assert.equal(
    await reviewTarget(
      client(),
      {
        ...review,
        event: "workflow_dispatch",
        display_title: "Dependency review PR 7",
      },
      repository,
      branch,
    ),
    7,
  );
});

test("intentionally skipped legacy runs need API job proof, never missing artifacts", async () => {
  const c = {
    api: async (path) => {
      assert.equal(path, "actions/runs/222/jobs?per_page=100");
      return { jobs: [{ status: "completed", conclusion: "skipped" }] };
    },
  };
  const legacy = {
    ...review,
    display_title: "Dependency review",
    status: "completed",
    conclusion: "skipped",
  };
  assert.equal(await reviewTarget(c, legacy, repository, branch), null);
  await assert.rejects(
    reviewTarget(
      { api: async () => ({ jobs: [] }) },
      legacy,
      repository,
      branch,
    ),
  );
  await assert.rejects(
    reviewTarget(c, { ...legacy, status: "in_progress" }, repository, branch),
    /lacks trusted PR association/,
  );
});

test("old source CI cannot make an active review relevant to a rebased identity", async () => {
  assert.equal(
    await reviewTarget(client(), review, repository, branch, undefined, {
      prNumber: 7,
      headSha: "d".repeat(40),
      testedSha: "e".repeat(40),
    }),
    null,
  );
});

test("only deliberate bulk and base refresh enumerate PRs; bulk approval is prohibited", async () => {
  for (const env of [
    { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
  ]) {
    const c = client();
    assert.deepEqual(
      await eventTargets(c, repository, branch, env, {
        inputs: { pr_number: "all", approve: "false" },
      }),
      [7],
    );
    assert.equal(c.calls.length, 1);
    assert.match(c.calls[0], /^pulls\?state=open&base=main/);
  }
  const c = client();
  assert.deepEqual(
    await eventTargets(
      c,
      repository,
      branch,
      { GITHUB_EVENT_NAME: "workflow_dispatch" },
      { inputs: { pr_number: "7" } },
    ),
    [7],
  );
  assert.deepEqual(
    await eventTargets(
      c,
      repository,
      branch,
      { GITHUB_EVENT_NAME: "pull_request_target" },
      { pull_request: { number: 7 } },
    ),
    [7],
  );
  assert.equal(c.calls.length, 0);
  await assert.rejects(
    eventTargets(
      c,
      repository,
      branch,
      { GITHUB_EVENT_NAME: "workflow_dispatch" },
      { inputs: { pr_number: "all", approve: "true" } },
    ),
  );
  await assert.rejects(
    eventTargets(
      client({
        prs: Array.from({ length: 257 }, (_, i) => ({ ...pr, number: i + 1 })),
      }),
      repository,
      branch,
      { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" },
      {},
    ),
    /exceeds 256/,
  );
});

test("latest attempts order by rerun start, not original creation or prior PASS", () => {
  const older = {
    id: 1,
    created_at: "2026-10-01T00:00:00Z",
    run_started_at: "2026-10-04T01:00:00Z",
    run_attempt: 2,
  };
  const newer = {
    id: 2,
    created_at: "2026-10-03T00:00:00Z",
    run_started_at: "2026-10-03T00:00:00Z",
  };
  assert.deepEqual(latestAttempts([newer, older]), [older, newer]);
});

test("every publisher uses the same per-PR lock including matrix base refreshes", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/dependency-merge-policy.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /matrix:\s+pr: \$\{\{ fromJSON\(needs.targets.outputs.prs\) \}\}/,
  );
  assert.match(
    workflow,
    /group: dependency-merge-policy-pr-\$\{\{ matrix.pr \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /max-parallel: 4/);
  assert.doesNotMatch(workflow, /group: dependency-merge-policy\s*\n/);
  assert.match(workflow, /PLAN_ONLY: "true"/);
  assert.match(workflow, /TARGET_PR: \$\{\{ matrix.pr \}\}/);
  const source = readFileSync(
    new URL("../../.github/workflows/dependency-review.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /run-name: Dependency review/);
  assert.doesNotMatch(source.split("\n")[1], /pull_request.title/);
});

test("a queued rerun of an old run takes precedence before its new attempt starts", () => {
  assert.equal(
    latestAttempts([
      { id: 2, status: "completed", run_started_at: "2026-10-04T00:00:00Z" },
      {
        id: 1,
        status: "queued",
        run_attempt: 2,
        run_started_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-04T01:00:00Z",
      },
    ])[0].id,
    1,
  );
});

test("trusted unrelated PR hints skip lookup while selected hints require source CI verification", async () => {
  const c = client();
  assert.equal(
    await reviewTarget(
      c,
      { ...review, display_title: "Dependency review CI 123 PR 8" },
      repository,
      branch,
      undefined,
      { prNumber: 7 },
    ),
    null,
  );
  assert.equal(c.calls.length, 0);
  await assert.rejects(
    reviewTarget(
      c,
      { ...review, display_title: "Dependency review CI 123 PR 8" },
      repository,
      branch,
    ),
    /hint disagrees/,
  );
  assert.equal(
    await reviewTarget(
      c,
      { ...review, display_title: "Dependency review CI 123 PR 0" },
      repository,
      branch,
    ),
    7,
  );
});
