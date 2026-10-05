# Dependency updates

Renovate prepares one weekly batch of routine updates. GitHub merges it when the
required CI passes. Major upgrades wait on the Dependency Dashboard until someone
requests them and remain manual to merge. There is no AI approval, release-note
artifact pipeline, custom merge status, or human-attestation command.

## Weekly batch

Install the [Renovate GitHub App](https://github.com/apps/renovate) for the actual
repository. The Wednesday window is midnight–10:00 in `America/Guayaquil`; the
hosted scheduler chooses when it runs. Stable patch/minor updates, including
Action pins/digests, share the `Weekly dependencies` PR across Bun, mise and
GitHub Actions. Routine releases must be at least three days old. The configuration
keeps at most three ordinary PRs active, including deliberately requested majors.
Standalone lockfile-maintenance PRs are disabled; ordinary updates refresh their
lockfiles as needed. Closed updates are not blanket-reopened for this migration.

GitHub native auto-merge waits for current required checks and an up-to-date base.
Renovate may update an existing batch after main changes so its CI can finish;
the weekly window controls when new routine branches are created. A failed batch
stays open for investigation rather than creating individual PRs for every package.

Major updates require a checkbox approval in the Dependency Dashboard before
Renovate creates their PR. That approval requests the update; it does not approve
merging. Inspect migration requirements, let CI finish, and review/merge normally.

## Security fixes and CI

GitHub vulnerability alerts can produce a separate fix PR without waiting for
Wednesday, with at most one security PR active alongside the ordinary budget.
Security fixes are not grouped into the routine batch. Major security upgrades
can be proposed immediately but still require manual merging. GitHub's dependency
graph and vulnerability-alert permissions must be enabled for Renovate to see them.

The required `CI validation` check includes frozen installation, formatting/lint,
types, unit/automation tests, the production build, browser smoke, Renovate
configuration validation and the dependency audit. Database validation runs when
the changed paths require it. Failed, cancelled or missing applicable checks block
merging. Review the failing CI job, fix the update or defer it, and rerun after
resolving the cause. No separate dependency approval is required.

Renovate's security-alert release-age exception affects candidate selection only.
Bun still enforces the configured three-day installation cooldown. For a reviewed
urgent fix that is younger than that, a maintainer may use an exact package/version
`minimumReleaseAgeExcludes` exception in `bunfig.toml`, with a reason and removal
plan in the PR. Keep the default cooldown and frozen installation; never bypass
CI to make an urgent update merge.

`task dependencies:audit` preserves exact, expiring exceptions from
`.github/dependencies/audit-exceptions.json`. The existing owner-approved
[braces advisory exception](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
applies only to `braces@3.0.3` with high severity and expires October 18, 2026 at
00:00 UTC. It does not fix the vulnerability; avoid untrusted glob patterns in
dependency tooling. Reassess/remove the exception before expiry. All other
advisories, expired exceptions and unavailable audit data fail CI.

## Repository setup and migration

1. Enable repository **Allow auto-merge** and keep the existing merge/review rules.
2. Require GitHub Actions `CI validation` on main with an up-to-date base. Preserve
   unrelated required checks and protections. Remove the retired `Dependency merge
   policy` requirement; otherwise deleted workflows leave every PR blocked.
3. Disable the old **Evaluate dependency merge policy** and **Dependency review**
   workflows as part of the transition. The implementation PR deletes those
   workflows, their reviewer/evidence code and their configuration. Remove the
   unused `DEPENDENCY_AUTOMERGE_ENABLED` and `DEPENDENCY_AI_REVIEW_ENABLED` Actions
   variables. The application `OPENAI_API_KEY` environment contract is unrelated
   and remains available; an unused Actions review secret can be removed separately.
4. Merge the reviewed implementation after its required CI passes. Renovate reads
   configuration from main; a PR containing this change does not activate grouping.
5. Let one qualifying routine batch go through CI and native auto-merge, or request
   that batch from the Dashboard for a controlled smoke check. Record its current
   head, successful required check and actual merge before claiming live rollout
   is complete. Do not recreate the old 40-PR backlog to test the replacement.

For a template-derived repository, use its own GitHub settings and Dashboard.
Copying these files does not enable repository auto-merge or modify its rulesets.
To pause routine automatic merging, set the routine rule's `automerge` to false
through a reviewed configuration change. The Dashboard remains the update list.

Run `task dependencies:config` to validate Renovate configuration and `task verify`
for local pre-PR validation. `task verify:all` adds browser E2E validation; CI runs
it automatically. After main deployment, confirm the retired workflows stay
inactive and no custom dependency status is required.
