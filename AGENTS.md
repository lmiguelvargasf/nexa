# Nexa Agent Guide

## Read First

- Use `README.md` for the human setup overview; keep this file agent-focused and short.
- Before changing Next.js routes, metadata, config, navigation, or framework APIs, read the relevant local guide under `node_modules/next/dist/docs/`. This repo uses Next.js 16, so older conventions may be wrong.
- Before opening a PR, read `.github/pull_request_template.md` and use it as the PR body contract.

## Commands

- Setup: `./scripts/setup.sh`
- Dev server: `task dev`
- Pre-PR validation: `task verify`
- Full validation, including browser E2E: `task verify:all`
- Dependency audit: `task audit`
- Local Supabase: `task db:start`
- Regenerate Supabase types: `task db:types`
- Email preview: `task email:dev`
- Runtime smoke check: `/api/health`
- Inspect publication mode/destination: `task agents:publication`; follow `docs/agent-publication.md` for the selected mode.
- Create other templated PRs with the current human login: `task pr:create -- --title "..." --base main`

## Repo Map

- `src/app/`: App Router routes, layouts, metadata, and global CSS.
- `src/components/ui/`: shadcn/ui primitives; keep generated component style compatible with `components.json`.
- `src/lib/`: Shared utilities and focused unit tests.
- `src/env.ts`: Typed environment contract; update this with any env var changes.
- `src/db/`: Generated Supabase database types; do not hand-edit generated files.
- `supabase/`: Local Supabase config and SQL migrations; migrations are schema source of truth.
- `emails/`: React Email templates.
- `e2e/`: Playwright tests.

## Conventions

- Use pinned tools from `mise.toml`; package management is Bun.
- Keep TypeScript strict and use the `@/` alias for `src/` imports.
- Use Biome for formatting, linting, and import organization.
- Use Tailwind CSS v4 tokens from `src/app/globals.css`; avoid ad hoc CSS systems.
- Use lucide icons for UI iconography.
- Add or update tests near the changed behavior when practical.

## Agent Skills

- Project-scoped skills live in `.agents/skills`; use them when relevant to the task.
- Skills supplement this guide; repo instructions and local Next.js docs remain authoritative.
- Do not install global skills with `-g` unless the user explicitly asks.

## GitHub Issues

- Use the project-scoped `github-issues` skill for issue work, with the existing authenticated `gh` CLI for reads and writes; GitHub MCP is optional. Resolve the destination from the current clone's GitHub repository before writing; never assume Nexa's original repository or an upstream example.
- Use the applicable `.github/ISSUE_TEMPLATE/` template first. This overrides the skill's instruction to always use its bundled templates; use those only when no repository template applies.
- Before creating an issue, search open and closed issues and read plausible matches. Distinguish duplicates from regressions and related work.
- Preserve reported facts, verified observations, reproduction attempts, and unknowns. Attempt reproduction when practical; unsuccessful or unavailable reproduction does not block recording a legitimate report.
- For implementation-ready work, capture observable acceptance criteria, important constraints, scope exclusions, and a source specification when available. Preserve supplied decisions; do not invent missing decisions or require a specification. Keep small work in one issue unless decomposition is requested or necessary and agreed.
- Read an issue before updating it; preserve unrelated content and metadata. Use the repository's actual labels and types, without inventing defaults.
- Verify requested writes. If a result is uncertain, inspect current state before retrying and reuse successful creations. Keep source links, parent/sub-issue grouping, and blocking dependencies distinct; verify native relationships when requested.
- Close issues with a meaningful reason and supporting evidence, such as a fix or canonical duplicate. Creating child issues does not complete their parent.

## Implementing GitHub Issues

- By default, a request such as "implement issue #123" includes implementation, validation, committing, pushing, and opening or updating a regular PR. Follow explicit task-scope overrides.
- Before editing, resolve the repository from the current clone, read the issue and relevant discussion, identify acceptance criteria, and inspect local/remote branches and related PRs. Confirm existing work belongs to that repository and issue before reusing it.
- Resume a matching implementation branch/PR without resetting existing work. For new work, fetch the intended base and create `issue/<number>-<short-description>` from current remote `main`, unless an explicit alternative base applies. Preserve unrelated local changes and exclude them from commits; use a separate worktree when necessary to avoid disturbing ongoing work.
- Implement the agreed scope, add appropriate tests, and review the diff. Run `task verify`, or `task verify:all` (which includes `task verify`) when browser validation is relevant. Record exact commands and outcomes.
- Fix introduced validation failures. If a required check remains failed or unavailable, report the blocker and incomplete validation instead of claiming completion or automatically substituting a draft PR.
- After successful implementation and validation, commit the issue changes and publish using the selected mode below and `docs/agent-publication.md`. Create or update a regular PR against the intended base. Complete every heading in `.github/pull_request_template.md`. Mark a reused draft ready when complete; reserve drafts for explicitly requested publication of unfinished work.
- Use `Closes #<number>` only when the PR fully resolves the issue; use a related-issue reference for partial work. Verify the published PR's base/head, body, issue reference, and ready-for-review state, then return its URL with a concise implementation and validation summary. Leave merging and issue closure to the established review/merge process.

## Publication Mode

- Resolve the destination from this clone's origin and inspect `task agents:publication` before publishing. Clone-local `nexa.publication.*` Git settings select the mode; global/included settings are ignored. Template-derived repositories default to `github`, using their own authenticated Git/`gh` setup. Confirm the active account and preserve unrelated/human PRs; do not transfer authorship.
- The canonical `lmiguelvargasf/nexa` repository explicitly requires `app` mode with the protected Briko publisher. If its local selection is absent, restore the documented App selection; do not publish as the maintainer. Other projects may explicitly select their own App, including the owner's Brikosi installation for repositories under the same personal account.
- In `app` mode, use the selected reviewed publisher outside every checkout. Keep App keys/config outside version control, tests, application code and PR reviewer sessions. Missing/invalid mode, paths, credentials, identity or destination scope is a blocker; never fall back to `github` after App selection fails.
- Commit author/committer identity is independent of publication mode; preserve accurate authorship and agent disclosures. Publisher selection does not make the App the commit author.

## Pull Requests

- Preserve every PR template heading.
- For noninteractive publication, fill a body file from the repository template and use `mise exec -- gh pr create --body-file <path>` with explicit `--repo`, `--head`, `--base`, and `--title`. Do not pass `--body` or `--body-file` to `task pr:create`: its `--template` flag is incompatible with those flags.
- Include exact validation commands and outcomes, or state why validation was not run.
- If using a GitHub connector or web UI instead of `gh`, manually build the PR body from `.github/pull_request_template.md`.
- Do not rely on `gh pr create --fill` as the final PR body; it can skip the template details reviewers need.
- Optional App publication uses scoped authentication for Git and `gh`, preserving the maintainer's global login. Both publication modes retain existing CI/review/merge protections; App authorship grants no approval or merge-policy exception.
