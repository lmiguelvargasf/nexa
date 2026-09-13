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
- Create a templated PR: `task pr:create -- --draft --title "..." --base main`

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

## Pull Requests

- Preserve every PR template heading.
- Include exact validation commands and outcomes, or state why validation was not run.
- If using a GitHub connector or web UI instead of `gh`, manually build the PR body from `.github/pull_request_template.md`.
- Do not rely on `gh pr create --fill` as the final PR body; it can skip the template details reviewers need.
