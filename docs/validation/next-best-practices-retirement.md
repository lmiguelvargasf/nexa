# Retired Next.js skill validation

## Decision and scope

Issue #21 is resolved by removing the retired `next-best-practices` skill and its
`skills-lock.json` entry together. Nexa already has version-matched documentation
in `node_modules/next/dist/docs/`, and its existing `AGENTS.md` requires reading the
relevant local guides before Next.js framework changes. The installed Next.js
16.2.6 guide `01-app/02-guides/ai-agents.md` confirms this approach. No replacement
skill or framework upgrade is needed. `vercel-react-best-practices` remains available
for performance guidance.

The upstream retirement is recorded in
[`vercel/nextjs-skills` at c522619e45aa3492fd2bfc916b308b275eff7798](https://github.com/vercel/nextjs-skills/blob/c522619e45aa3492fd2bfc916b308b275eff7798/README.md).
No historical source commit is invented or pinned.

## Standalone checks

The implementation branch starts from remote `main` at
`d84a73ba134df3eaa78e0801ad27ca5185ebdf66` in a separate worktree.

- `mise exec -- task verify`: passed Biome (24 files), Next.js route type generation,
  TypeScript, 2 application unit tests, and the production build.
- `mise exec -- task hooks:run`: passed all applicable hooks.
- `git diff --cached --check`: passed.
- Structural assertions compared the manifest against the base after removing
  only the retired entry: all 16 remaining entries are identical. The retired
  directory is absent. Git byte comparisons confirm all other skill and license
  files, `AGENTS.md`, and issue/PR templates are unchanged after hooks. The bundled
  Next.js agent guide exists in the installed package.
- `task verify:all`: not run; this retirement changes no application/browser behavior.

The four mutating whitespace/BOM/newline hook exclusions match the policy proposed
in PR #20. This permits all-file hook validation without rewriting unrelated
upstream bytes. Other checks remain enabled, and the `github-issues` maintenance
contract is preserved. Repository-owned files remain subject to formatting checks.

## Live updater integration

The updater is not yet on `main`. A temporary checkout combined PR #20's exact
head `284c12e11255fa4c7b0c4c1c97c3d28b19ec570d` with this issue's retirement changes,
then committed that combination locally so the updater's clean-checkout
requirement could be exercised. Neither original checkout nor PR #20 was changed.

`mise exec -- task skills:check` fetched the remaining tracked sources and completed
preparation, including source, bundle, lock, and license comparisons. It reached
`mise exec -- task verify` without querying the retired skill. The approved
github-issues revision remained installed, and the newer candidate remained pending
prior review.

The integrated update then failed Biome because the newly downloaded upstream file
`.agents/skills/resend/references/fetch-all-templates.mjs` uses single quotes while
Nexa's formatter requires double quotes. The updater exited 1 (Task wrapper exit
201), saved a `failed` report, and published nothing. Hooks and final post-hook
comparisons were not reached in that integrated proposal.

This verifies that the retired-source blocker is removed. It does **not** establish
a successful complete skill-update run: the independent vendor-formatting problem
must be resolved separately. No fetched skill updates are included in this PR.
