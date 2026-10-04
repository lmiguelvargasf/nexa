# Skill updater validation

## Isolated fixture coverage

`mise exec -- task skills:test` runs Node's test runner against
`scripts/skills/*.test.mjs`: **38 tests passed**. Preparation tests use local source
fixtures and injected installers. Publication tests use real local Git repositories
and bare remotes with mocked GitHub responses; they do not create live PRs.

Covered behavior includes:

- Changed updates copy full skill bundles, lock metadata, and attribution together;
  missing previous revisions remain explicitly unknown.
- Unchanged and repeated preparations install nothing and do not create metadata
  churn; known license-only changes produce reviewable proposals.
- github-issues candidates stay pending until their exact source and license hashes
  match the approved record. An approved revision can be installed while a newer
  revision stays pending. Post-hook byte/hash/license tampering fails.
- Failed fetches, retired paths, malformed manifests, symlinks, unexpected installer
  metadata, and unexplained missing bundled files fail without publishing.
- Changed and repeated publication maintains one regular PR. Maintainer body/title
  edits are preserved. Manual or amended branch commits, a concurrent writer, an
  advanced default branch, wrong repositories/push remotes, and closed or unowned
  PRs prevent destructive publication.
- Uncertain PR creation, denied creation, and failed report comments recover against
  the existing branch/PR without duplicate creations or reports.
- The runner uses a separate checkout and empty preparation directory, validates
  before publication, blocks unexpected untracked skills, preserves template
  headings, and never publishes local checks or failed/no-change preparations.
- The actual Biome executable ignores vendored upstream examples, including
  explicit mutating CLI targets, while continuing to reject and fix formatting in
  repository-owned source. Vendor bytes remain unchanged throughout the fixture.

These fixtures establish local control flow and Git lease behavior. Mocked GitHub
responses do not establish live token permissions, event delivery, API concurrency,
or scheduled execution.

## Live source and installer checks

The actual `skills@1.5.26` executable reported `1.5.26`. Isolated explicit installs
of `github-issues` at `7568a482ce2df38f8965ab5336a3220db796a4ba` matched all 11
upstream files and generated folder hash
`3eb6f99553920d6d94e47cb9e31432b10e2a6a235d9fc972165ec824a71ba0e9`.
The external license matched upstream Git blob
`89bc5e962c9944cdb050887062afdaaf89be504a`. A repeated explicit install produced
no content changes or incidental agent directories.

The implemented default preparation was also exercised against real GitHub sources
and the real pinned CLI in a temporary single-skill project, with a synthetic old
hash solely to force a refresh of the already-reviewed revision. Full file, lock,
and license verification passed. Repeating preparation returned no changes. The
new upstream tip `143a3d976b3c1603cc8932984d5e1f28501cb5fc` remained pending;
detection did not approve it, even though the skill content hash was unchanged.
This was an isolated installation test, not an adopted update to Nexa's manifest.

A live `vercel-react-best-practices` install verified the differing installed skill
name and source folder (`skills/react-best-practices`). It also confirmed that the
pinned CLI omits bundled `metadata.json` while counting it in the lock hash; the
updater restores known omitted files from the fetched source before comparison.

The initial live source audit found a blocker at
`vercel/nextjs-skills@c522619e45aa3492fd2bfc916b308b275eff7798`: the repository
retired `skills/next-best-practices/SKILL.md` and now directs users to bundled Next.js
docs. Preparation failed with the source, full revision, and missing path,
asking maintainers to review the retirement before changing the manifest.
Issue #21 was subsequently resolved by merged PR #22, which removed the retired
directory and lock entry together. This implementation branch was rebased onto
that merge (`498395fd412eaf8ff4fed1f8a5b781cf0e2a29a5`); its manifest now tracks
16 skills. The initial failure below records historical failed-source handling.

The full default runner was exercised from a clean committed checkout with
`mise exec -- task skills:check`. It reached this same retired source and exited
unsuccessfully (updater exit 1; Task wrapper exit 201), saved a `failed` result,
left the original checkout's skills/lock unchanged, and published nothing. This
is verified failed-source handling, not a passing end-to-end update. The isolated
proposal did not proceed to app/hook validation after source preparation failed.

### Current live check after issue #21

After rebasing onto merged PR #22 and excluding vendored examples from Biome,
`mise exec -- task skills:check` passed from a clean committed checkout. All 16
tracked sources prepared successfully; 11 skills had proposed updates. The isolated
proposal passed `mise exec -- task verify` (including 38 updater fixtures and the
production build), `mise exec -- task hooks:run`, and the post-hook upstream
file-list, byte, lock-hash, and license comparisons. A second explicit
`verifySources` invocation confirmed those comparisons against the retained
upstream snapshots.

The result was `validated-local-proposal`. github-issues remained at its reviewed
revision, with candidate `143a3d976b3c1603cc8932984d5e1f28501cb5fc` pending prior
review. The source-retirement and Resend formatting blockers are resolved. The real
checkout's skill directories, licenses, and lock remain identical to the updated
base; the proposed updates were retained only in the isolated checkout. No automated
update PR was published, and the scheduled/default-token publication path has not
been live-tested before the workflow reaches the default branch.

## Repository checks and formatting

`mise exec -- task verify` passed Biome, route type generation/TypeScript, the
application unit tests, updater fixtures, and the production build.
`mise exec -- task hooks:run` passed all applicable repository hooks.
`task verify:all` was not run because no browser/application behavior changed.

The first all-files hook run exposed pre-existing whitespace/newline changes in
vendored skills and a license. Those modifications were restored byte-for-byte.
The four mutating file-hygiene hooks exclude all vendored skill and attribution
files, extending the existing github-issues exception. After retirement, a combined
live proposal exposed an additional formatting conflict in the newly downloaded
Resend `references/fetch-all-templates.mjs` example. Biome now force-ignores vendor
skill/license directories, and its mutating hook excludes them too. Repository-owned
code remains checked, and vendor syntax/secret checks remain enabled. No installed
skill, license, or current lock entry is changed by this implementation PR relative
to the updated base.

After the passing hook run, `diff -qr` against the independently fetched pinned
github-issues snapshot and `cmp` for the external license both passed. The exported
`hashDirectory` function also matched the installed folder to the lock hash.

## Live GitHub configuration

The running clone resolved to `lmiguelvargasf/nexa`. Read-only API checks confirmed
Actions enabled and all actions allowed. The repository's Actions PR-creation
setting was initially disabled. It was enabled for this workflow and read back:

```json
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": true
}
```

The setting also permits approvals in GitHub's terminology; the workflow never
approves or merges PRs. No personal token or paid service was configured. This is
an observed repository setting, not proof of future token writes under every
organization or branch-protection policy.

The new scheduled workflow has not run from the default branch before merge.
No live automated skill-update PR was created to simulate a successful full update.
The implementation PR and its normal CI are separate from that automation.
