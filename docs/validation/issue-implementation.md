# Issue implementation workflow checks

These are synthetic policy walkthroughs for the "Implementing GitHub Issues"
section of `AGENTS.md`. Issue numbers and failure conditions below are fixtures,
not reports about Nexa. They check the written instructions; they do not prove
that every coding agent will follow them or exercise live GitHub operations.
No throwaway issues or PRs are needed.

## Policy walkthroughs

| Scenario | Input | Walkthrough result |
| --- | --- | --- |
| New implementation | "Implement issue #123"; clean checkout; no existing implementation; required checks pass. | Resolve the clone's repository, read the issue/discussion and acceptance criteria, inspect branches/PRs, fetch remote `main`, and create `issue/123-short-description`. Implement, test, review, commit, push, and publish a regular PR. An explicit alternative base overrides `main`. |
| Existing branch or PR | Issue #123 already has an implementation branch and a related PR, possibly a draft. | Confirm the repository and issue match, resume existing work without resetting it, and update the same PR. When implementation and required validation succeed, mark a reused draft ready. A similar branch name alone is insufficient to establish a match. |
| Unrelated local changes | The checkout contains uncommitted work for another task. | Preserve that work, keep it out of the issue commit, and use a separate worktree when needed. Do not reset unrelated changes to obtain a clean branch. |
| Failed or unavailable validation | An introduced test fails, a required check has a pre-existing failure, or the environment cannot run it. | Fix introduced failures. Any remaining failed or unavailable required check blocks normal completion. Report the command, outcome, and blocker; do not claim success or automatically create a draft as a fallback. |
| Template completeness and issue linkage | A completed implementation fully resolves issue #123; a separate fixture addresses only part of it. | Populate every PR-template heading with concrete context and exact validation evidence. The complete fixture uses `Closes #123`; the partial fixture uses a related-issue reference. Verify the published PR's base/head, body, reference, and ready state before returning its URL. |
| Regular PR default | The user requests a completed implementation without specifying draft publication. | Create a regular PR. The default command has no `--draft`; draft publication is reserved for an explicit request to share unfinished work. Publishing a PR does not itself merge it or close the issue. |

Result: all six walkthroughs have an explicit outcome in the policy. AI reviewer
integration, automated review-response loops, and automatic merging remain
outside this change.

## Local command and template checks

Preview the existing helper without creating a PR:

```sh
mise exec -- task --dry pr:create -- --title "Issue workflow check" --base main
```

The preview invokes `gh pr create` with
`--template .github/pull_request_template.md`, the supplied title/base, and no
`--draft`. The helper does not populate the body; the policy requires the agent
to do so.

An actual attempt to pass a completed `--body-file` to this helper was rejected
before PR creation: GitHub CLI does not allow `--template` with `--body` or
`--body-file`. For noninteractive publication, fill the repository template in a
body file, then call `mise exec -- gh pr create --body-file <path>` directly with
explicit repository, head, base, and title arguments. This reuses the same
template without changing the existing interactive helper.

Inspect the PR template headings:

```sh
rg '^## ' .github/pull_request_template.md
```

The six required headings are Summary, Agent Review Context, Change Surface,
Validation Evidence, AI Authorship Note, and Review Guide. Populate all six,
including reasons for inapplicable or unrun checks. A reason for an unrun
required check does not turn that check into a pass.

The implementation PR records actual repository validation and live branch/PR
verification separately from these synthetic walkthroughs.
