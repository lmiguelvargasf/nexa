# Project skill updates

The **Skill updates** workflow checks the skills already in `skills-lock.json`
each Wednesday at **14:23 UTC (09:23 America/Guayaquil)**. GitHub scheduling is
best effort and can be delayed. Scheduled workflows run from the default branch;
GitHub may disable schedules in inactive public repositories after 60 days.
Use **Actions → Skill updates → Run workflow**, selecting the default branch, for
an on-demand run. Disable it through **Actions → Skill updates → … → Disable
workflow**, or remove the `schedule` trigger while retaining manual runs.

## Repository setup

The workflow resolves identity from the running repository's `origin`, checks it
against `GITHUB_REPOSITORY`, and uses explicit repository arguments for GitHub
writes. No Nexa repository name is built into the updater. Its only write target
is `automation/skill-updates`; never the default branch. Maintainers merge PRs
manually. There is no auto-merge or automated approval step.

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub
Actions to create and approve pull requests**. The workflow uses the built-in
`GITHUB_TOKEN`; no paid service, app installation, or personal access token is
required. Keep the repository's default token permission read-only. Only this
job requests `contents: write`, `pull-requests: write`, and `statuses: write`.
The PR setting's wording includes approval, but this workflow only creates PRs
and never approves one. Organization policy can prevent enabling the setting;
in that case an administrator must resolve it before publication will work.

Read-only setup checks, with the actual clone's owner/repository:

```bash
mise exec -- gh api repos/OWNER/REPOSITORY/actions/permissions
mise exec -- gh api repos/OWNER/REPOSITORY/actions/permissions/workflow
```

The latter must allow PR creation (`can_approve_pull_request_reviews: true`).
Denied Git pushes, protected update branches, and denied PR creation fail the
run with the underlying GitHub error. After changing policy, rerun the workflow.
Do not add broad credentials to work around an unexplained failure.

## Preparation and provenance

`scripts/skills/update.mjs` clones the checked-out commit into a temporary,
isolated checkout. It reads only the tracked manifest, resolves each source's
default-branch tip to a full commit, and fetches source bytes at that revision.
Missing or moved skill paths fail; the updater never substitutes another path,
adds a skill, or removes one automatically. Sources must be GitHub repositories.
Symbolic links are unsupported and fail rather than escaping the target directory.

For changed skills, the pinned and version-checked **Skills CLI 1.5.26** runs in
separate empty staging directories:

```bash
mise exec -- bunx skills@1.5.26 add \
  'https://github.com/OWNER/SOURCE/tree/FULL_COMMIT/PATH_TO_SKILL' \
  --skill TRACKED_NAME --agent codex --yes
```

Only that installed skill and its verified lock entry are copied to the proposal.
Never use `skills update --project`, `--global`, or `--all`: the generic update
command in this CLI version can create incidental agent directories. This version
also excludes `metadata.json`, `__pycache__`, and `__pypackages__` from installation
while counting them in its source hash. The updater restores only these known
omissions from the fetched source, then verifies the complete file list and bytes.
Other omissions, extra files, metadata mismatches, and installation errors fail.

Applicable root and ancestor license/notice files are preserved under
`.agents/licenses/OWNER--SOURCE/` with their original relative paths; the existing
`github-awesome-copilot-LICENSE` location remains unchanged. Bundled licenses and
references remain inside their skill. Review attribution diffs as part of each PR.
Absence of an upstream license does not invent permission; maintainers must assess
whether they can continue using that source.

The generated report records proposed full commits and hashes, prior hashes,
and previous commits only when actually recorded. Older entries without `ref`
are reported as **unknown (not recorded)**. Equal content does not manufacture
a previous revision or create a provenance-only update.

Updated lock entries also record `licenseHash`; later attribution-only changes
then produce a reviewable update. Older entries without that field have unknown
previous license provenance, and the updater does not invent it.

`AGENTS.md`, repository templates, application code, and unselected skills are
protected from installation and publication changes. Keep Nexa-specific policy
outside upstream skill directories.

## Reviewing a github-issues candidate before installation

The [existing maintenance contract](github-issues.md) remains authoritative.
`.github/skills-review.json` is a repository-owned review gate. Its initial entry
records the already-reviewed full commit, source/path, folder hash, and applicable
license hash. Merely finding a new upstream commit does **not** update this file,
mark it reviewed, or install it. The run reports a pending candidate separately;
other skill updates can still proceed if there are no failures.

1. Read the pending candidate's full SHA in the workflow report. Download it for
   inspection without installing or approving anything:

   ```bash
   mise exec -- bun scripts/skills/review-candidate.mjs FULL_UPSTREAM_COMMIT
   ```

2. Compare the entire candidate `skills/github-issues/` folder and all bundled
   references against the recorded full commit. Compare the root and ancestor
   license/notice files too. Review invocation behavior, tools, labels/types,
   template precedence, and compatibility with Nexa's `gh` policy. Fetch the old
   commit separately if needed; do not treat a detection/hash check as review.
3. After that review, replace only the `github-issues` record in
   `.github/skills-review.json` with the inspected candidate's printed values.
   Submit this review record through a normal PR, explaining the upstream and
   license review. Do not alter `skills-lock.json` yet. Maintainer review/merge
   makes this approval available to the scheduled updater on the default branch.
4. Run the updater. It fetches the approved exact revision and verifies the review
   record's folder and license hashes **before** installing. A later upstream tip
   remains pending; it does not replace the approved revision. The installer uses
   the explicit full-commit command, synchronizes the external license, and checks
   all installed bytes and the generated lock hash again after hooks.

The license hash is SHA-256 over sorted relative license paths followed by each
file's bytes, using the exported `hashLicenses` function. Do not hand-invent it.
A malformed record or mismatched source, hash, or license fails the run.

## Validation and one maintained PR

Changed proposals install dependencies with `mise exec -- bun install
--frozen-lockfile`, stage only skill/lock/attribution files, then execute:

```bash
mise exec -- task verify
mise exec -- task hooks:run
```

The updater repeats upstream file-list, byte, lock-hash, and license comparisons
after hooks, including `github-issues`. A hook that changes upstream bytes or
any failed source/validation check blocks publication. `task verify` includes
fixture tests for the updater itself. Tests cannot determine whether new skill
instructions are appropriate: source and license review remains required.

Biome and the four whitespace/BOM/line-ending/final-newline fixers exclude
vendored `.agents/skills/` and `.agents/licenses/` files so they preserve upstream
bytes. The Biome configuration force-ignores these directories, and its mutating
hook excludes them too. Repository-owned code, configuration, and guidance remain
subject to the normal checks. The other vendor hooks, including syntax and secret
checks, remain enabled. Upstream file-list, byte, hash, and attribution verification
validate the vendor copies after hooks.

These checks run inside the update job **before** it creates or refreshes the PR.
GitHub suppresses workflows triggered by token-authenticated pushes. Its current
PR-event behavior can create runs that require a maintainer to select **Approve
workflows to run**; the updater therefore does not depend on those runs for its
own validation. After publication,
it attaches the `Skill updates / validation` success status to the validated tree's
published commit. If branch protection requires an ordinary CI check too, approve
the waiting workflow or use a supported maintainer trigger before merging; never
bypass it. See [GitHub's current token-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

The update branch contains a generated commit with ownership metadata binding its
tree and base. Refreshes verify ownership and use a Git lease to protect against
concurrent edits. A maintainer commit causes an actionable stop instead of being
overwritten. Job concurrency serializes scheduled/manual runs. Existing PR body,
title, and comments are preserved; a changed refresh adds an idempotent report
comment with the current changed skills and exact validation outcomes. The initial
body and each report preserve every heading in `.github/pull_request_template.md`.
The latest report comment is authoritative after a refresh.

No-change runs create no PR. Identical repeat runs reuse the existing PR and do
not add duplicate reports. An uncertain creation/comment response is checked
against current GitHub state before recovery. If publication fails after a push,
rerun to recover the same branch/PR. The updater never closes an existing PR just
because a later run is unchanged.

For a manually edited update branch, finish the review manually or deliberately
close its PR and delete the branch after preserving needed edits; the next run
can then start fresh. A closed, unmerged generated PR is treated as a maintainer
decision and must be resolved explicitly, not silently reopened.

## Failures and local maintenance

Every run emits a job summary and `skill-update-report` artifact. Inspect
`result.json`, any `proposal.json` / `pull-request.md`, and the workflow log.
`failed` means the run did not complete successfully; partial preparations are
never published. `pending-review` means there were no installable changes and a
review gate remains outstanding; it is not a completed upgrade of that skill.
Fix the source, review record, permissions, or check failure and rerun. Do not
relabel failures as a successful complete update.

From a clean committed local checkout:

```bash
mise exec -- task skills:check
```

This uses the same installer and validation in an isolated checkout, prints the
retained checkout/report locations, and never pushes or creates a PR. Inspect the
proposal there. For manual publication, create a branch in that checkout, commit
only the skill/lock/license diff after successful checks, and follow `AGENTS.md`'s
regular PR process. Rerun validation if you edit the proposal. The updater's
`--publish` entry point is reserved for the default-branch Actions workflow.
For just `github-issues`, the explicit manual refresh procedure in
[`docs/github-issues.md`](github-issues.md) continues to apply, including prior
review, license synchronization, and byte/hash checks before and after hooks.

The implementation's [validation record](validation/skill-updates.md) separates
isolated tests from live source and GitHub observations.

References: [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[token-trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
and the [Skills CLI source](https://github.com/vercel-labs/skills).
