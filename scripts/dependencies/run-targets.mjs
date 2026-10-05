import { jsonArtifact } from "./github.mjs";
import { SHA } from "./policy.mjs";

export const REVIEW_WORKFLOW = ".github/workflows/dependency-review.yml";
export const ACTIVE = [
  "requested",
  "queued",
  "pending",
  "waiting",
  "in_progress",
];

export function prNumber(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error("Invalid PR number");
  return Number(value);
}

// List APIs order by creation, which can hide a newer rerun of an older run.
export function latestAttempts(entries) {
  const started = (run) =>
    Math.max(
      Date.parse(run.run_started_at ?? run.created_at) || 0,
      ACTIVE.includes(run.status) ? Date.parse(run.updated_at) || 0 : 0,
    );
  return [...entries].sort((a, b) => started(b) - started(a) || b.id - a.id);
}

export async function ciTarget(client, run, repository, branch) {
  if (
    run.path !== ".github/workflows/ci.yml" ||
    !SHA.test(run.head_sha ?? "") ||
    !run.head_repository?.full_name ||
    !run.head_branch
  )
    throw new Error("Invalid CI run provenance for event association");
  // Main/push/manual CI has no PR; its base refresh is handled by the push event.
  if (run.event !== "pull_request") {
    if (
      ["push", "workflow_dispatch"].includes(run.event) &&
      run.head_branch === branch &&
      run.head_repository.full_name === repository
    )
      return null;
    throw new Error("Unsupported CI event association");
  }
  const linked = run.pull_requests ?? [];
  if (linked.length > 1) throw new Error("Ambiguous CI-to-PR association");
  let pr;
  if (linked.length === 1)
    pr = await client.api(`pulls/${prNumber(linked[0].number)}`);
  else {
    const owner = run.head_repository.full_name.split("/")[0];
    const matches = await client.pages(
      `pulls?state=open&base=${encodeURIComponent(branch)}&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`,
      3,
    );
    if (matches.length !== 1)
      throw new Error("Cannot uniquely associate CI with an open PR");
    pr = matches[0];
    // A branch name alone cannot associate an old run with a reused branch.
    if (![pr.head.sha, pr.merge_commit_sha].includes(run.head_sha))
      throw new Error(
        "CI branch association has an obsolete or unrelated revision",
      );
  }
  if (
    pr.head.repo?.full_name !== run.head_repository.full_name ||
    pr.head.ref !== run.head_branch ||
    pr.base.repo?.full_name !== repository ||
    pr.base.ref !== branch
  )
    throw new Error("CI-to-PR repository/branch identity mismatch");
  return pr.number;
}

export async function reviewTarget(
  client,
  run,
  repository,
  branch,
  token,
  identity,
) {
  if (
    run.path !== REVIEW_WORKFLOW ||
    run.head_branch !== branch ||
    run.head_repository?.full_name !== repository ||
    !SHA.test(run.head_sha ?? "") ||
    !["workflow_run", "workflow_dispatch"].includes(run.event)
  )
    throw new Error("Invalid trusted review run provenance");
  // These titles are emitted by the trusted default-branch run-name expression,
  // never a PR title, branch-provided artifact, or workflow_run event identifier.
  const marker =
    /^Dependency review (CI|PR) ([1-9]\d*)(?: PR (0|[1-9]\d*))?$/.exec(
      run.display_title ?? "",
    );
  if (marker) {
    const number = prNumber(marker[2]);
    if (marker[1] === "PR" && run.event === "workflow_dispatch" && !marker[3])
      return number;
    if (marker[1] === "CI" && run.event === "workflow_run") {
      const hint = marker[3] && marker[3] !== "0" ? prNumber(marker[3]) : null;
      // The hint comes from trusted run-name's GitHub PR relationship, not PR
      // content. Filter unrelated runs cheaply; selected hints are verified
      // against the refetched source CI before any evidence is accepted.
      if (identity && hint && hint !== identity.prNumber) return null;
      const ci = await client.api(`actions/runs/${number}`);
      if (ci.id !== number)
        throw new Error("Review source CI run identity mismatch");
      const target = await ciTarget(client, ci, repository, branch);
      if (hint && target !== hint)
        throw new Error("Review PR hint disagrees with source CI identity");
      if (
        identity &&
        ![identity.headSha, identity.testedSha].includes(ci.head_sha) &&
        !ci.pull_requests?.some(
          (pr) =>
            pr.number === identity.prNumber &&
            pr.head?.sha === identity.headSha,
        )
      )
        return null;
      return target;
    }
    throw new Error("Review event and association marker disagree");
  }
  // Migration: old intentionally skipped workflows have no input artifact.
  // Verify every job in the current attempt was skipped before ignoring them.
  if (run.status === "completed" && run.conclusion === "skipped") {
    const { jobs } = await client.api(
      `actions/runs/${run.id}/jobs?per_page=100`,
    );
    if (
      jobs.length > 0 &&
      jobs.length < 100 &&
      jobs.every(
        (job) => job.status === "completed" && job.conclusion === "skipped",
      )
    )
      return null;
  }
  if (ACTIVE.includes(run.status))
    throw new Error(
      "Legacy active review lacks trusted PR association; rerun the updated review workflow",
    );
  const input = await jsonArtifact(
    client,
    run.id,
    token,
    repository,
    "dependency-review-input",
    "report.json",
  );
  if (input.runId !== run.id || input.identity?.repository !== repository)
    throw new Error("Legacy review association has invalid provenance");
  return prNumber(input.identity.prNumber);
}

export async function eventTargets(
  client,
  repository,
  branch,
  env,
  event,
  token,
) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    if (event.inputs.pr_number === "all") {
      if (event.inputs.approve === "true")
        throw new Error("Bulk human approval is forbidden");
    } else return [prNumber(event.inputs.pr_number)];
  } else if (env.GITHUB_EVENT_NAME === "pull_request_target") {
    return [prNumber(event.pull_request?.number)];
  } else if (env.GITHUB_EVENT_NAME === "workflow_run") {
    const id = prNumber(event.workflow_run?.id);
    const run = await client.api(`actions/runs/${id}`);
    if (run.id !== id) throw new Error("Workflow event run identity mismatch");
    const number =
      run.path === REVIEW_WORKFLOW
        ? await reviewTarget(client, run, repository, branch, token)
        : await ciTarget(client, run, repository, branch);
    return number === null ? [] : [number];
  } else if (env.GITHUB_EVENT_NAME !== "push") {
    throw new Error("Unsupported merge-policy event");
  } else if (env.GITHUB_REF !== `refs/heads/${branch}`) {
    throw new Error("Base refresh must target the default branch");
  }
  const prs = await client.pages(
    `pulls?state=open&base=${encodeURIComponent(branch)}`,
    3,
  );
  if (prs.length > 256)
    throw new Error(
      "Bulk refresh exceeds 256 PRs; dispatch smaller individual batches",
    );
  return prs.map((pr) => prNumber(pr.number));
}
