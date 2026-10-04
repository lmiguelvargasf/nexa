# Dependency updates

Normal CI validates every PR. Dependency policy applies only when the actual PR
diff changes dependencies or their resolution/install configuration; a bounded
Sol review remains restricted to qualifying Renovate updates. Application-only,
documentation-only, and other non-dependency PRs do not require the dependency
policy's custom human attestation. GitHub's general review and merge rules still
apply.

Renovate prepares updates; CI validates them; a bounded Sol review assesses compatibility.
Stable same-major minor and patch updates can merge automatically for **every dependency**:
Bun application/development/optional/peer packages and version-only overrides,
mise tools/runtimes, and GitHub Actions. Framework, auth, database, validation and
payment packages have no category exclusion. Action version/digest pinning can
also qualify. Major upgrades, prereleases, standalone lock maintenance, unrelated
code changes and incomplete evidence require human review.

Automatic merging always requires current applicable CI and a complete,
current-policy `gpt-6.1-sol` / medium `PASS`. Renovate requests native PR merging;
GitHub's required checks decide when it happens. Global Renovate `automerge`
remains false, with explicit non-major and Action pin rules enabling it.
GitHub repository auto-merge and `DEPENDENCY_AUTOMERGE_ENABLED=true` must also be
set in each destination repository; copying configuration does not activate it.

## Schedule and update sources

Install the [hosted Renovate GitHub App](https://github.com/apps/renovate) for this
repository (or the destination repository when copying this template). The weekly
window is Wednesday, midnight–10:00 in `America/Guayaquil`. The hosted scheduler
chooses its actual run within the window. Keep at most three routine PRs open;
detected vulnerability PRs may bypass that cap and the weekly schedule.

The configuration supports Bun manifests/lockfiles, mise pins/lockfiles, and
GitHub Actions, including digest pinning. Related React/Next.js, AI SDK, email,
Node and Bun declarations remain grouped. Every update in a group must qualify.
Renovate's minor/patch label alone never authorizes a merge.

The gate supports stable exact, caret and tilde package declarations, preserving
the operator while increasing the minimum version within the same major.
Resolved direct versions must satisfy their declaration/override, stay in that
major and never downgrade. Caret ranges on 0.x use the SemVer range rules, not
the entire zero major. **0.x minor/patch updates are included by owner decision;
they can contain breaking changes**, so numeric eligibility is not compatibility
approval. Declaration-only updates qualify with identical installed entries.
Transitive additions/removals/version changes are supplied exhaustively to Sol;
non-registry sources, invalid integrity, changed same-version data, install trust,
workspace configuration or lock format require human review.

Version-only overrides may qualify; adding/removing dependencies or changing
scripts, trust, engines independently of a corresponding runtime update, and
other manifest behavior cannot. mise updates must preserve settings, tasks,
backends and platform/provenance policy, and provide synchronized exact pins and
checksummed versioned lock URLs. Optional `url_api` download metadata must use the
same GitHub repository's canonical release-asset endpoint. Review preparation
verifies the API asset's exact download URL and any published SHA256 against the
lock; missing or inconsistent metadata blocks automatic approval. Backend,
platform set and provenance changes still require human review.
Bun packageManager/engine and Node engine
minimums track their mise updates. Standard-library Python 3.11+ `tomllib` reads
TOML as data; dependency code is never evaluated to parse it.

Action updates change only existing remote `uses` references and their version
comments. Workflow commands, permissions, inputs, conditions and structure stay
unchanged. Exact upstream commits are resolved; an immutable digest must match
its annotated version tag. Sol receives upstream release notes or bounded exact
source comparisons plus workflow consumers. Missing/large source evidence
requires a human rather than a partial paid review. Tool review uses complete
old-to-new sections from `CHANGELOG.md` at the verified upstream commit, with an
exact bounded source comparison fallback when that changelog is unavailable.
Latest-release notes alone cannot establish a multi-release tool upgrade.
Tool setup, locked platform sources and hook consumers are included as evidence;
CI installs locked prek and runs hooks, failing on errors or tracked mutations.
Policy version 5 invalidates
old reviews; obtain fresh current CI and Sol PASS after deployment.

Before accepting onboarding, verify a real Bun update changes both `package.json`
and `bun.lock` and a real tool update keeps `packageManager`/`engines`, `mise.toml`,
and `mise.lock` consistent. Configuration validation and local extraction prove
recognition, not hosted lockfile regeneration. Recent Renovate/mise versions
support safe-mode lockfile generation; verify that it works in the installed App
before considering any administrator permission changes.

Routine releases must be three days old. `bunfig.toml` applies the same cooldown
to newly resolved transitives; existing locked versions remain unchanged.
Renovate's vulnerability integration depends on available advisory feeds. Bun
version-update support does not imply complete GitHub dependency-graph coverage.
CI runs `task dependencies:audit`; an unavailable audit, expired exception, or any advisory outside the exact approved exception fails validation. `task audit` remains the unfiltered diagnostic and currently fails for the known advisory.

The user approved a temporary exception for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), only `braces@3.0.3` with high severity, until **October 18, 2026 at 00:00 UTC**. Upstream reports no patched release. This does not fix its stack-exhaustion risk: avoid user-supplied glob patterns in dependency tooling. The exact exception lives in `.github/dependencies/audit-exceptions.json`, appears in CI output, and requires reassessment/removal before expiry. All other baseline advisories were remediated by same-major direct updates, refreshed transitive resolution, and a Next.js 16.3.8 override covering the email preview dependency. Install-script trust policy is unchanged.

For an urgent verified security fix blocked by the cooldown, take over the PR
manually and use a narrowly selected version, for example:

```sh
mise exec -- bun update affected-package@fixed-version --minimum-release-age 0 --ignore-scripts
mise exec -- task verify:all
mise exec -- task dependencies:audit
```

Review the actual install-hook requirements separately, keep scripts/trust policy
unchanged, and record the advisory and cooldown exception in the PR. Do not remove
the default cooldown, disable the audit, or broadly enable automatic merging to
expedite a security update.

## CI and required checks

Hosted Ubuntu jobs use `ubuntu-24.04`. Adopting Ubuntu 26.04 requires a separate,
tested update; this label still receives GitHub's weekly runner image and package
updates, so it does not freeze the image contents.

Artifact actions use the Node.js 24 releases
[`upload-artifact@v7`](https://github.com/actions/upload-artifact/releases/tag/v7.0.0)
and [`download-artifact@v8`](https://github.com/actions/download-artifact/releases/tag/v8.0.0).
Uploads retain the default ZIP archive format (`archive: true`), including single
JSON files read across runs by the dependency review and merge policy. Downloads
retain extraction by artifact name into the configured path; digest mismatches
now fail by default. Artifact names, retention and provenance checks are unchanged.
[`cache@v6`](https://github.com/actions/cache/releases/tag/v6.0.0) also declares
Node.js 24; cache paths, keys and restore keys stay unchanged. These major upgrades
require manual review under the dependency policy above.

The always-present **CI validation** job aggregates scope, application
validation, and database validation for every PR. Required checks include frozen
installation, format/lint, types, unit/automation tests, production build, all three
browser smoke projects, and auditing. Database validation runs for dependency/toolchain,
Supabase, and relevant CI changes, through a reusable workflow. A legitimately
inapplicable database job is skipped; failure, cancellation, a missing result, or a
skipped required job fails the aggregate. Absent pgTAP tests do not establish
tested database behavior. The scope job reports dependency applicability with the
exact head/base/tested SHAs in its summary. That report is diagnostic: trusted
follow-up workflows recompute applicability from Git objects rather than trusting
PR-produced classification or artifacts.

The temporary **Dependency validation** job is a compatibility alias. It always
runs after **CI validation** and succeeds only when that aggregate succeeds;
failure, cancellation, skipping, and missing results cannot produce a successful
alias. Preserve the alias throughout the required-check migration:

1. Publish the workflow with both names and verify a successful hosted
   **CI validation** check on the current implementation PR.
2. In the existing default-branch ruleset, add **CI validation** from GitHub Actions
   (integration 15368), keeping **Dependency validation** and
   **Dependency merge policy** required until the new check is verified.
3. Verify the published required-check configuration and GitHub's PR check
   association, then remove only the old **Dependency validation** requirement.
   Keep the compatibility job until trusted default-branch consumers have moved
   to **CI validation**. Existing default-branch consumers still require the
   legacy name; updated consumers require **CI validation**. The compatibility
   job satisfies the old consumers without weakening either assertion.

The final required checks are **CI validation** and **Dependency merge policy**
from GitHub Actions (integration 15368). Keep strict up-to-date branches, existing
PR/review/deletion/force-push protections, and no bypass actors throughout. These
settings are configured in GitHub, not enabled by workflow YAML. Never remove the
old CI requirement before the replacement is available, temporarily relax checks,
or add a bot bypass to complete the rollout. Record hosted check identities and
ruleset reads as rollout evidence; local fixtures do not prove deployment.
Verify this migration in each destination repository. Enable repository automatic
merging only after the gate and required checks are verified.

The advisory **Dependency review** workflow must
not be a required check: missing funding or AI `NEEDS_HUMAN` must not prevent a
maintainer from completing an otherwise validated PR.

`task e2e` now expects an existing production build and starts a fresh `next start`
server. `task verify:all` builds first. Close any other server on the configured
port, or set `PORT` to an available one.

## Enable the advisory pilot

1. Create a dedicated OpenAI API project and API key. Fund it with an initial $5
   prepaid balance, leave auto-reload off, and explicitly enable an enforced $5
   monthly project hard spend limit. A spend alert alone does not stop traffic.
2. Add the project key as repository Actions secret `OPENAI_API_KEY`. Never put
   it in a PR, `.env` artifact, job-wide environment, or runner authentication file.
3. Set repository Actions variable `DEPENDENCY_AI_REVIEW_ENABLED=true`.
4. Open/update a same-repository Renovate PR and let the **CI** workflow finish.
   A maintainer can also dispatch **Dependency review** with its PR number.
5. Inspect the advisory comment and sanitized `dependency-review-result` artifact.
   Compare findings and evidence against your own review; merge manually after
   required CI succeeds.

The fixed model is `gpt-6.1-sol`, effort `medium`, with standard API processing.
The official Codex Action is pinned to reviewed commit
`86365089eb2b84e0a8fb0717b304f8bdcb13b20e` and CLI/proxy `0.160.0`. Review new versions
before changing these pins. The earlier Luna benchmark and budget estimate do not
establish Sol's quality or costs.

Only trusted default-branch scripts/prompts/config run in the privileged follow-up
workflow. PR files are read through Git objects as data; PR scripts/config and
installation hooks are never executed with the API key. The reviewer uses a new
empty workspace, read-only permissions, privilege dropping, disabled shell/tools,
no browsing/apps/plugins/multiple agents, and no merge credential. A separate
runner publishes feedback with PR-comment permissions and no OpenAI secret.
Installation and tests occur in the ordinary CI jobs without that secret.

The evidence bundle contains exact versions, relevant lockfile diff, bounded
application source usage, exact release notes or versioned upstream source
comparison, CI outcomes, and head/base/tested merge identities. Missing,
truncated, oversized, or unsupported evidence produces human-review feedback
without spending on a partial review. Package, runtime/tool and Action updates share the evidence/review path;
unsupported or unrelated changes remain manual without a partial AI call. An AI result must match the JSON schema and
exact identities; `PASS` requires no findings or uncertainties. It remains advisory.

## Usage, limits, and reruns

The bundle limit is 96 KiB, at most five distinct declared dependency transitions, 24 KiB per release
source, and an 8 KiB validated response. Review jobs have a ten-minute timeout and
one active job per PR, cancelling obsolete work. Previously reported identities
are not automatically reviewed again. Identity includes head, base, tested merge,
model/effort, policy, prompt, schema, and trusted reviewer configuration. The
publisher rechecks current PR identity before posting; stale feedback is rejected.

The workflow does not retry failures automatically. The CLI may perform its own
transport retries; it does not expose a supported hard total-token/call ceiling
used here. JSON size limits constrain the final text, not reasoning tokens. The
job timeout and explicitly enforced API project cap are the backstops. Limit
propagation can permit a small spend overrun. Do not claim a guaranteed per-run
cost or number of monthly reviews.

The report extracts numeric usage from CLI session events and estimates token
cost at $2/M input, $0.10/M cached input, and $10/M output (October 3, 2026 standard
rates). Reasoning is included in output, never charged twice. Raw sessions and
API credentials are not uploaded. Missing usage is reported as unknown, not zero;
failed/cancelled reviews may still cost money. Compare estimates with actual API
project usage and update the rate configuration when rates change. API billing is
separate from the ChatGPT subscription; funding is never performed by a workflow.

For a rerun, select Actions → Dependency review → Run workflow, enter the PR
number, and select `force` only when intentionally repeating an already reported
identity. This is necessary after fixing missing setup for an already reported PR.
Billing/quota failures require checking project balance/limits before a forced
rerun. A PR needs successful current CI first; new commits, rebases, or a changed
base require fresh validation. An expired/missing identity artifact requires a CI
rerun. Upstream rate limits or missing release data require human review or a
later intentional rerun, not a paid retry loop.

Disable advisory review immediately by setting `DEPENDENCY_AI_REVIEW_ENABLED=false`
and cancelling active review jobs. Remove/rotate the API secret if necessary.
Disable update creation in the Renovate App or set `enabled: false` in Renovate
configuration. Disabling advisory review is not a merge kill switch; use the
automatic-merging shutdown procedure below.

## Pilot findings and remaining validation

As of October 3, 2026:

- The hosted Renovate App, API secret, review-enable variable, $5 prepaid balance,
  auto-reload disabled, and enforced $5 project spend cap were verified. Copied
  repositories must perform their own setup.
- Two real Renovate updates passed frozen CI and complete Sol review with no
  findings or uncertainties. Both changed only declared ranges; installed
  versions and transitive entries were already at the targets. They do not prove
  fresh lockfile resolution or regression detection for changed installed code.
- Four paid reviews totaled $0.118648 in estimated token cost. The first pair
  unnecessarily questioned the tested merge relationship; supplying its validated
  parents, exact lock entries and adjacent test source resolved that evidence gap.
- Repeating an unchanged review identity skipped the model job, demonstrating the
  duplicate-review guard. Authorized human completion and rejection of stale
  approval were also demonstrated.
- Native automatic merging was demonstrated for an eligible tailwind-merge
  declaration update after current CI, complete Sol PASS and the trusted gate.
  The owner subsequently expanded eligibility to every dependency. Fresh resolved
  upgrades and hosted mise lockfile synchronization remain to be demonstrated;
  fixtures prove policy behavior, not integration regression detection.

Keep dated workflow identities, human assessments, missed regressions/false
approvals, unnecessary blocks, and token/cost data in the implementation's GitHub
record. Operational instructions must remain understandable without those links.
A fixed pilot count is an operational milestone, not a safety certification.

### Trusted merge policy and human completion

**Evaluate dependency merge policy** executes only default-branch code, never
installs/checks out PR code, and has no OpenAI secret or merge permission. It writes
the explicit commit status **Dependency merge policy** on the PR head and current
synthetic merge commit, covering GitHub's revision precedence. This status
is separate from its workflow job: follow-up/dispatch job checks alone do not
satisfy PR required-check plumbing. Per-PR serialized evaluations read live API state,
invalidate on PR/CI/review activity and main advancement, and recheck head/base/merge
and selected CI/review attempts before publishing decisions on either revision. Strict branch protection and GitHub native
auto-merge provide the final up-to-date check and merge; there is no custom queue
or merge API call.

Applicability is independent of author, branch, labels, and automatic-merge
eligibility. The trusted classifier compares the complete PR diff from its unique
merge base to the exact current head and reads files as data. It classifies these
changes as applicable:

- Package dependency declarations (including additions/removals, peer metadata,
  overrides/resolutions, patched dependencies, and bundled dependencies), package manager/engine
  declarations, and workspace/catalog/install trust or platform configuration in
  `package.json`. Changes limited to scripts or ordinary package metadata do not
  themselves create dependency scope.
- Any `bun.lock` or `bun.lockb` content change, including standalone transitive
  changes, semantic changes to the `bunfig.toml` install table, and patch files
  under `patches/` or with the `.patch` extension.
- Tool declarations, plugins, or lockfile settings in `mise.toml` (including
  supported environment/local variants), and any `mise.lock` content change.
- Added, removed, or changed remote GitHub Action `uses` references (including
  Docker references) in workflows and action manifests, Action lockfiles,
  container/service images, runner/runtime declarations, and tool-version inputs
  such as `codex-version`. Ordinary workflow logic, comments, or formatting
  changes alone do not create dependency scope; duplicate existing runtimes do
  not introduce a new version.

Mixed code/dependency changes, human-authored updates, major/prerelease updates,
and other ineligible dependency changes remain applicable. The classifier is
conservative about install policy and intentionally separate from the narrower
automatic-merge rules. Missing/ambiguous Git ancestry, unreadable evidence, or invalid supported data
fails closed. Complete readable YAML outside the bounded parser's syntax is
conservatively applicable and requires the existing manual review path. Neither
case can produce a non-applicable bypass.

For a current non-dependency PR, **Dependency merge policy** publishes an explicit
successful **not applicable** decision on the current head and synthetic merge
revision, rechecking their identity before publishing. It does not load dependency
review evidence, invoke AI, or require the custom human attestation. This lightweight
status is still visible because GitHub requires its context for all PRs. It does
not assert that an AI review occurred or replace **CI validation** or general
GitHub review protections. New head/base revisions trigger fresh classification.

For an applicable dependency PR, every successful decision requires the latest
current CI to pass, all aggregate jobs to succeed, and the tested and current
GitHub synthetic merge commits to have the exact current head/base parents.
GitHub may regenerate the synthetic commit with a different timestamp; a different
SHA qualifies only when both commits also have the identical complete Git tree.
Missing tree data or changed content blocks approval. The original CI-tested SHA
stays in the review and approval identity. While current-revision CI has not
started or is queued/running, the policy stays pending and still blocks merging.
CI start events also reevaluate reruns so a previous failure can return to pending.
Completed unsuccessful CI and invalid or missing validation/review evidence produce
a failing status with a link to the workflow summary. Legitimately inapplicable
database checks remain handled by **CI validation**.

Every evaluation writes its decision and reason to the job log and summary.
Pending decisions produce a notice: the evaluator can finish successfully while
the required commit status continues waiting for CI. Failed decisions produce an
error annotation and fail that PR evaluator. Bulk refreshes keep evaluating
other PRs with independent matrix jobs. A green evaluator job therefore does not mean a pending PR is approved.
Human-authored dependency PRs remain applicable in automatic mode and receive an
explicit human-approval message instead of an automatic-review identity error.
Failure summaries link to the manual workflow and include the exact head/base
inputs; the maintainer must personally review those revisions before attesting.

Human completion of an applicable dependency PR uses an explicit revision-bound
attestation, including for ineligible updates and AI failures. Review the diff and
CI yourself, then select Actions → Evaluate
dependency merge policy → Run workflow on **main**, set the PR number, check
`approve`, and enter the full reviewed head/base SHAs. The CLI equivalent is:

```sh
mise exec -- gh pr view PR_NUMBER --repo OWNER/REPO --json headRefOid,baseRefOid
mise exec -- gh workflow run dependency-merge-policy.yml --repo OWNER/REPO --ref main \
  -f pr_number=PR_NUMBER -f approve=true \
  -f expected_head=REVIEWED_HEAD_SHA -f expected_base=REVIEWED_BASE_SHA
```

Only a human with current write/maintain/admin permission can attest. This supports
solo maintainers reviewing their own PRs. The attestation does not waive CI or
repository protection. It is stored as a small Actions artifact, bound to
repository/PR/head/base/tested identity and current trusted review policy; future
evaluations verify its workflow/run provenance and the actor's current permission.
New commits, rebases, base/policy changes, or expired/deleted artifacts require fresh
approval. To withdraw approval, close the PR or change its revision; cancel any
queued native auto-merge first. Comments, labels, and a successful AI process are
never approval. Selecting `approve=false` simply reevaluates; it does not revoke
a prior attestation.

Automatic approval additionally requires both activation controls below, the
actual Renovate bot identity, independently computed dependency eligibility
over the entire Git diff and lockfile, and a schema-valid complete `PASS` artifact
from the current trusted **Dependency review** workflow. The latest matching
review attempt must succeed; an older PASS cannot mask a later error or block.
Reruns are ordered by attempt start (including queued reruns), and new reports
include the attempt number so an earlier attempt cannot supply evidence for a rerun.
Artifacts are read as bounded JSON, never executed. Recent evidence lookup is
limited to 100 workflow runs, with 30-day review/approval retention and 7-day CI
identity retention; missing, ambiguous, expired, or older evidence blocks and
requires an intentional rerun. No review database is introduced.

### Targeted evaluations and rollout recovery

CI and review start/completion events refetch the source run from GitHub and
resolve only its affected PR. PR event payloads and CI-produced artifact identifiers
cannot choose another target. CI association uses the API's PR relationship, or a
unique repository/branch match with a matching current head/test merge. Fork CI is
supported for human completion. Missing/ambiguous associations fail the resolver
with an actionable error instead of scanning the backlog or guessing.

Trusted review run names encode either the source CI run ID with a GitHub PR
relationship hint, or the manually requested PR number. Unrelated PR hints avoid
artifact/API fan-out; selected hints must match the refetched source CI. The gate validates workflow/repository/default-branch
provenance and resolves the source CI through GitHub before requesting artifacts.
Legacy entirely skipped runs are ignored only after the API confirms every job was
skipped. Other legacy completed runs still require their trusted input artifact;
an unassociated active or artifact-less legacy run requires an intentional updated
review rerun. There is no blanket artifact-error suppression. A relevant completed
missing/expired/corrupt/ambiguous artifact still blocks; disabled preparation and
`NEEDS_HUMAN` give their actual reason. A relevant active review stays pending and
completion triggers reevaluation. A duplicate with the exact current identity may
reuse its previously completed evidence; newer failed attempts cannot do so.

Only main pushes and deliberate `pr_number=all` dispatches enumerate open PRs
(maximum 256). Bulk human approval is forbidden. The read-only resolver produces a
matrix with at most four simultaneous evaluators. Every evaluator, including a
base refresh, takes the same concurrency lock for its PR. There is no repository-
wide status-publication lock. Queued legacy workflow definitions lack the new per-PR matrix target and
stop before writing rather than competing with the new lock. Obsolete checkouts stop before writing; head, base,
merge, and selected run changes skip obsolete final statuses. The current activity
triggers the next evaluation. GitHub status writes are not an atomic transaction
with revision changes; per-PR serialization, repeated freshness checks, strict
up-to-date protections and native merging remain necessary together.

After merging this repair through the normal review process, validate one existing
eligible same-major update first. Refresh its branch/lockfile through Renovate,
wait for successful current frozen CI, and inspect the fresh bounded review.
Dispatch `Dependency review` for that PR only if needed; use `force=true` only for
an intentional repeat of a reported identity. Record CI/review/gate run URLs,
current head/base/tested merge, complete PASS, and both required commit statuses.
If evidence is missing/oversized, review is disabled, or Sol requires a human,
record that blocker and use the existing personally reviewed attestation path;
do not increase evidence limits or manufacture PASS. The new trusted workflow
cannot be demonstrated on an implementation branch before default-branch rollout.

Resume routine updates in batches of at most three (the existing
`prConcurrentLimit`), inspect outcomes before proceeding, and use individual gate
dispatches for retrying existing PRs. The limit controls new PR creation; it does
not reduce the already open backlog. Do not close/rewrite/merge existing PRs as
cleanup or repeatedly force full-dashboard refreshes. Main advances still require
fresh revision-bound evidence for affected updates.

#### October 4, 2026 frozen-install diagnosis (#108)

All four observed failed runs stop at the same transitive release-age blocker:
`ip-address@10.7.3` cannot be resolved under Bun's default 259200-second cooldown.
Each corresponding Renovate artifact-update comment reports the same error for
`bun.lock`; each PR currently changes only `package.json`, leaving its override
change unsynchronized with the lockfile. Isolated copies of those four manifest
changes reproduce the same failure with `bun install --frozen-lockfile --ignore-scripts`
on pinned Bun 1.4.2. This is independent of the gate's review
lookup error, not a successful frozen install or four distinct application test
regressions.

| PR | Override change | Failed current CI run |
| --- | --- | --- |
| [#67](https://github.com/lmiguelvargasf/nexa/pull/67) | `ws` 8.21.0 → 8.21.3 | [37228713799](https://github.com/lmiguelvargasf/nexa/actions/runs/37228713799) |
| [#91](https://github.com/lmiguelvargasf/nexa/pull/91) | `ws` 8.21.0 → 8.22.0 | [37228961590](https://github.com/lmiguelvargasf/nexa/actions/runs/37228961590) |
| [#100](https://github.com/lmiguelvargasf/nexa/pull/100) | `fast-uri` 3.1.8 → 4.2.1 | [37229052537](https://github.com/lmiguelvargasf/nexa/actions/runs/37229052537) |
| [#102](https://github.com/lmiguelvargasf/nexa/pull/102) | `protobufjs` 7.6.6 → 8.8.0 | [37229071147](https://github.com/lmiguelvargasf/nexa/actions/runs/37229071147) |

The [npm registry publication record](https://registry.npmjs.org/ip-address) gives
`10.7.3` as October 1, 2026 at 22:35:03.666 UTC. Its three-day threshold is
**October 4 at 17:35:03.666 America/Guayaquil (22:35:03.666 UTC)**. Retry Renovate
artifact generation after that threshold, one PR at a time; confirm a regenerated
`bun.lock` is committed, then rerun frozen CI against the resulting current head.
Repeating CI on the unchanged manifest-only PR is insufficient to repair the lock.
Any further newly resolved package can have its own cooldown; record its exact
registry publication time rather than waiving the policy. The unchanged main
lockfile installs successfully because its versions are already locked; these
changed overrides trigger fresh resolution. Major override upgrades (#100/#102)
still require mandatory human review even after their installs pass. Preserve the
three-day default, frozen installs, existing security-exception procedure, evidence
budgets and merge eligibility. No existing dependency PR is modified by this repair.

### Activation ordering

1. Merge the gate implementation through the existing review process. Leave
   automatic merging disabled. Run the new workflow on a current validated PR,
   demonstrate both its failing unapproved status and successful human path, and
   verify GitHub associates the explicit status with that PR head.
2. Add **Dependency merge policy** from GitHub Actions (integration 15368) as a
   required status in the existing main ruleset. Preserve **CI validation**
   (and the legacy **Dependency validation** requirement during its migration),
   strict up-to-date branches, PR requirements, and no bypass actors. Do this only
   after the status has been produced successfully; requiring an unpublished
   workflow would deadlock its own implementation PR.
3. Assess and record actual Renovate PRs and Sol outcomes/costs. Record the
   maintainer's explicit activation decision. Fixtures and a dashboard are not a
   completed pilot. Use a naturally occurring eligible update; do not invent one
   or change eligibility just to manufacture a demonstration.
4. In a reviewed configuration PR, set policy `mode: "automatic"` and
   `automaticMerging: true`, and add
   `automerge: true` plus `automergeType: "pr"` to all minor/patch updates and
   Action pin/digest updates in `renovate.json`. Keep global `automerge: false`,
   `platformAutomerge: true`, and `rebaseWhen: "behind-base-branch"`. Keep major,
   prerelease and standalone lock maintenance updates manual. The gate evaluates all
   actual file/dependency changes, regardless of Renovate's classification.
5. Verify both required statuses and strict rules, enable GitHub repository
   auto-merge, then set `DEPENDENCY_AUTOMERGE_ENABLED=true`. Obtain a fresh current
   Sol review after the configuration change; old-policy results cannot qualify.
   Record an actual eligible native automatic merge before declaring end-to-end
   activation validation complete. The reviewer retains no merge credential.

To stop automatic merging, disable repository auto-merge and cancel already queued
PR auto-merges, set `DEPENDENCY_AUTOMERGE_ENABLED=false`, and dispatch evaluations
for open PRs. Then revert the automerge rules/policy activation in a reviewed PR, setting
`mode: "supervised"` and `automaticMerging: false`.
Changing a variable alone does not cancel a merge already queued by GitHub. Human
completion and all deterministic required checks remain available. Disabling AI
review does not count as approval.

## Local validation

```sh
mise exec -- task dependencies:config
mise exec -- task dependencies:test
mise exec -- task verify:all
mise exec -- task dependencies:audit
```

Fixture tests mock GitHub and upstream APIs, use isolated Git/ZIP data, and never
call OpenAI. They cover applicability, missing/failed/cancelled/skipped checks,
Renovate identity/forks, grouped updates and transitive evidence, lock consistency,
schema/revision failures, unavailable setup, deduplication, data-only preparation,
source-evidence completeness, usage, and stale publication. They cannot establish
hosted App behavior, GitHub required-check plumbing, model quality, or live billing
limit enforcement. Record those separately during onboarding and the pilot.

References: [Renovate](https://docs.renovatebot.com/configuration-options/),
[release cooldown](https://docs.renovatebot.com/key-concepts/minimum-release-age/),
[Codex Action](https://learn.chatgpt.com/docs/github-action),
[Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[spend limits](https://developers.openai.com/api/docs/guides/spend-limits),
[GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
