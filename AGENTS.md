<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Map

## Project Shape

- `src/app/`: Next.js App Router routes, layouts, metadata, and global CSS.
- `src/components/ui/`: shadcn/ui-owned primitives using the radix-nova style.
- `src/lib/`: Shared utilities and unit-tested helpers.
- `src/env.ts`: Typed environment variable contract. Update this when adding env vars.
- `src/db/`: Generated Supabase database types. Do not hand-edit generated files.
- `supabase/`: Local Supabase config and migrations. SQL migrations are schema source of truth.
- `emails/`: React Email templates.
- `e2e/`: Playwright end-to-end tests.

## Commands

- Install and initialize: `./scripts/setup.sh`
- Start app: `task dev`
- Pre-PR checks: `task verify`
- Full validation including browser E2E: `task verify:all`
- Start local Supabase: `task db:start`
- Generate database types after schema changes: `task db:types`
- Preview emails: `task email:dev`

## Conventions

- Use pinned tools through `mise.toml`; package management is Bun.
- Keep TypeScript strict and prefer the `@/` path alias for `src/` imports.
- Use Biome for formatting, linting, and import organization.
- Use Tailwind CSS v4 tokens from `src/app/globals.css`; keep UI primitives compatible with shadcn/ui and Radix.
- Use lucide icons when adding iconography.
- Put reusable unit tests beside source files as `*.test.ts` or `*.test.tsx`.
- For Next.js API, route, config, navigation, or file-convention work, read the relevant local guide under `node_modules/next/dist/docs/` first.

## Pull Requests

- Always read `.github/pull_request_template.md` before opening a PR.
- Create PRs with `task pr:create -- --draft --title "..." --base main` unless the user requests a different flow.
- Preserve every template heading and fill each section with concrete paths, symbols, validation commands, and outcomes.
- If validation is not run, write the exact reason in the template instead of deleting the checklist item.
- If a GitHub connector or web UI is used instead of `gh`, manually build the PR body from `.github/pull_request_template.md`.
