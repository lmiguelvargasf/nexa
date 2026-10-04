# Dependency updates

Renovate prepares updates; CI validates them; a bounded Sol review can provide
advisory feedback. **Every merge is manual during this supervised delivery.**
`renovate.json` has `automerge: false`, the policy has `automaticMerging: false`,
and `DEPENDENCY_AUTOMERGE_ENABLED` is unset. Changing a label or receiving AI
`PASS` cannot enable merging. The trusted merge gate is implemented separately
from the secret-bearing reviewer; requiring it and activating merging are rollout
steps, tracked in [#29](https://github.com/lmiguelvargasf/nexa/issues/29).

## Schedule and update sources

Install the [hosted Renovate GitHub App](https://github.com/apps/renovate) for this
repository (or the destination repository when copying this template). The weekly
window is Wednesday, midnight–10:00 in `America/Guayaquil`. The hosted scheduler
chooses its actual run within the window. Keep at most three routine PRs open;
detected vulnerability PRs may bypass that cap and the weekly schedule.

The configuration supports Bun manifests/lockfiles, mise pins/lockfiles, and
GitHub Actions, including digest pinning. Related React/Next.js, AI SDK, email,
Node, and Bun declarations are grouped. Major upgrades stay separate; all updates
are manually reviewed. `clsx` and `tailwind-merge` stable patches are the proposed
future helper allowlist. They are a candidate classification, not permission to
merge. Other file changes, mixed/protected updates, 0.x/prerelease/minor/major
updates, changed scripts/trust/overrides, inconsistent lockfiles, and transitive
changes require a human.

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

The always-present **Dependency validation** job aggregates scope, application
validation, and database validation. Required checks include frozen installation,
format/lint, types, unit/automation tests, production build, all three browser smoke
projects, and auditing. Database validation runs for dependency/toolchain,
Supabase, and relevant CI changes, through a reusable workflow. A legitimately
inapplicable database job is skipped; failure, cancellation, a missing result, or a
skipped required job fails the aggregate. Absent pgTAP tests do not establish
tested database behavior.

After this workflow has produced a successful check, configure a ruleset for the
repository's default branch in GitHub Settings → Rules → Rulesets:

- Require a pull request and **Dependency validation** from GitHub Actions.
- Require branches to be up to date before merging (strict checks).
- Preserve the repository's other protections; do not add a bot bypass.
- Keep repository automatic merging disabled throughout the pilot.

The supplied repository initially had a disabled ruleset and no active branch
protection. Workflow YAML does not enable these settings by itself. Verify them
in the destination repository. For `lmiguelvargasf/nexa`, ruleset [17001152](https://github.com/lmiguelvargasf/nexa/rules/17001152) was activated on October 3 after [PR #25 CI](https://github.com/lmiguelvargasf/nexa/actions/runs/37169889584) passed. It preserves the previous PR/deletion/force-push rules, requires **Dependency validation** specifically from GitHub Actions (integration 15368), enforces an up-to-date base, and has no bypass actors. Repository automatic merging remains disabled. These settings are repository-specific and do not transfer with the template.

The same ruleset now also requires **Dependency merge policy** from GitHub Actions.
The owner-authorized human path passed for #34, #35, and #36 before merging their
fixes. These approvals retained current CI and exact reviewed head/base identities;
both required statuses were verified green. Repository auto-merge remains off.

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
without spending on a partial review. Runtime/tool/workflow-only updates are
reviewed manually without an AI call. An AI result must match the JSON schema and
exact identities; `PASS` requires no findings or uncertainties. It remains advisory.

## Usage, limits, and reruns

The bundle limit is 64 KiB, at most five changed direct packages, 12 KiB per release
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
configuration. None of these actions changes the manual merge requirement.

## Pilot record and later activation

Keep issue #16 open for the activation stage. Record each real PR here or in its
issue discussion: PR and review identities, human assessment, useful findings,
missed regressions/false approvals, unnecessary blocks, token/cost data, and time
saved. A fixed pilot count is an operational milestone, not a safety certification.

| Evidence | Current status |
| --- | --- |
| Local configuration validation/extraction and isolated failure-path fixtures | Recorded in the implementation PR |
| Hosted Renovate installation and a reproducible Bun/mise update | Nexa-only installation 167693154 and dashboard #28 verified; #31/#32 update Bun declarations consistently and pass frozen CI, but retain existing resolved versions; fresh resolution and hosted mise synchronization remain to be demonstrated |
| Funded project, API secret and enforced spending cap | Secret, review-enable variable, $5 prepaid balance, auto-reload off, and enforced $5 project cap verified October 3; real Sol calls and numeric usage now recorded in #16 |
| Active required-check rules in the destination repository | Verified for Nexa ruleset 17001152; reconfigure for copied repositories |
| Real PR outcomes and measured Sol costs | First two reviews returned schema-valid NEEDS_HUMAN at estimated $0.027454 and $0.027900; evidence gaps corrected in #36; assessment and subsequent results are recorded in #16 |
| Maintainer's automatic-merge activation decision | Pending; automatic merging disabled |

The first paid reviews validated the plumbing and cost reporting, but incorrectly
questioned different head/test-merge SHAs because their input omitted the validated
parent relationship. The updated bundle includes that proof, exact locked entries,
exhaustive resolved-package changes, CI steps/baseline workflow, and adjacent test
source within the existing byte/file bounds. Compatibility and merge eligibility
are assessed separately; an advisory PASS cannot override a human-review policy.
Use the [issue #16 discussion](https://github.com/lmiguelvargasf/nexa/issues/16#issuecomment-5976211780)
for the dated pilot record and latest results. These declaration-only samples do
not establish compatibility of a newly resolved upgrade or justify activation.

### Trusted merge policy and human completion

**Evaluate dependency merge policy** executes only default-branch code, never
installs/checks out PR code, and has no OpenAI secret or merge permission. It writes
the explicit commit status **Dependency merge policy** on the PR head and current
synthetic merge commit, covering GitHub's revision precedence. This status
is separate from its workflow job: follow-up/dispatch job checks alone do not
satisfy PR required-check plumbing. Serialized evaluations read live API state,
invalidate on PR/CI/review activity and main advancement, and recheck head/base
immediately before publishing success. Strict branch protection and GitHub native
auto-merge provide the final up-to-date check and merge; there is no custom queue
or merge API call.

Every successful decision requires the latest current CI to pass, all aggregate
jobs to succeed, and the tested and current GitHub synthetic merge commits to
have the exact current head/base parents. GitHub may regenerate the synthetic
commit with a different timestamp; a different SHA qualifies only when both
commits also have the identical complete Git tree. Missing tree data or changed
content blocks approval. The original CI-tested SHA stays in the review and
approval identity. Failed or missing evidence produces a failing status with a
link to the workflow summary. Legitimately inapplicable database checks remain
handled by **Dependency validation**.

Once required, the gate applies to all PRs to the default branch. Human completion
uses an explicit revision-bound attestation, including for protected updates and
AI failures. Review the diff and CI yourself, then select Actions → Evaluate
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
actual Renovate bot identity, independently computed stable helper eligibility
over the entire Git diff and lockfile, and a schema-valid complete `PASS` artifact
from the current trusted **Dependency review** workflow. The latest matching
review attempt must succeed; an older PASS cannot mask a later error or block.
Artifacts are read as bounded JSON, never executed. Recent evidence lookup is
limited to 100 workflow runs, with 30-day review/approval retention and 7-day CI
identity retention; missing, ambiguous, expired, or older evidence blocks and
requires an intentional rerun. No review database is introduced.

### Activation ordering

1. Merge the gate implementation through the existing review process. Leave
   automatic merging disabled. Run the new workflow on a current validated PR,
   demonstrate both its failing unapproved status and successful human path, and
   verify GitHub associates the explicit status with that PR head.
2. Add **Dependency merge policy** from GitHub Actions (integration 15368) as a
   required status in the existing main ruleset. Preserve **Dependency validation**,
   strict up-to-date branches, PR requirements, and no bypass actors. Do this only
   after the status has been produced successfully; requiring an unpublished
   workflow would deadlock its own implementation PR.
3. Assess and record actual Renovate PRs and Sol outcomes/costs in #16. Record the
   maintainer's explicit activation decision. Fixtures and a dashboard are not a
   completed pilot. No eligible helper patch currently appears in Nexa's dashboard;
   do not invent an update or widen eligibility just to demonstrate merging.
4. In a reviewed configuration PR, set policy `automaticMerging: true` and add
   `automerge: true` plus `automergeType: "pr"` **only** to the existing stable
   helpers patch rule in `renovate.json`. Keep global `automerge: false`,
   `platformAutomerge: true`, and `rebaseWhen: "behind-base-branch"`. Keep security,
   minor/major, and protected update rules manual. The gate still evaluates all
   actual file/dependency changes, regardless of Renovate's classification.
5. Verify both required statuses and strict rules, enable GitHub repository
   auto-merge, then set `DEPENDENCY_AUTOMERGE_ENABLED=true`. Obtain a fresh current
   Sol review after the configuration change; old-policy results cannot qualify.
   Record an actual eligible native automatic merge in #29 and #16 before closing
   activation work. The reviewer retains no merge credential.

To stop automatic merging, disable repository auto-merge and cancel already queued
PR auto-merges, set `DEPENDENCY_AUTOMERGE_ENABLED=false`, and dispatch evaluations
for open PRs. Then revert the helper rule/policy activation in a reviewed PR.
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
Renovate identity/forks, grouped/protected/transitive changes, lock consistency,
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
