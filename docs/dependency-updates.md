# Dependency updates

Renovate prepares updates; CI validates them; a bounded Sol review can provide
advisory feedback. **Every merge is manual during this supervised delivery.**
`renovate.json` has `automerge: false`, and the review policy rejects any mode other
than `supervised`. Changing a label or receiving AI `PASS` cannot enable merging.

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
in the destination repository. The advisory **Dependency review** workflow must
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
| Hosted Renovate installation and a reproducible Bun/mise update | Pending external setup/onboarding |
| Funded project, API secret and enforced spending cap | Not verified; no paid pilot review run |
| Active required-check rules in the destination repository | Must be verified after the new check exists |
| Real PR outcomes and measured Sol costs | Pending pilot |
| Maintainer's automatic-merge activation decision | Pending; automatic merging disabled |

After the pilot, implement and demonstrate a trusted required merge policy with
an explicit manual completion path before enabling the approved helper subset.
It must evaluate every direct/transitive/file change outside the LLM, verify
current tested/reviewed revisions, and require AI `PASS` for automatic merges.
An authorized human's review of the current revision must provide the manual path;
AI failure must never authorize automatic merging or force protection bypass.
Use strict GitHub checks, Renovate rebasing, and platform-native merging. The AI
reviewer retains no merge permission. No custom merge coordinator/queue, release
crawler, review database, multiple reviewers, or autonomous application fixes are
part of this delivery.

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
