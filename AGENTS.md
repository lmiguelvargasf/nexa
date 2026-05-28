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
- Local Supabase: `task db:start`
- Regenerate Supabase types: `task db:types`
- Email preview: `task email:dev`
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

## Pull Requests

- Preserve every PR template heading.
- Include exact validation commands and outcomes, or state why validation was not run.
- If using a GitHub connector or web UI instead of `gh`, manually build the PR body from `.github/pull_request_template.md`.
- Do not rely on `gh pr create --fill` as the final PR body; it can skip the template details reviewers need.
