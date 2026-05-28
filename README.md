# Nexa

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/docs)
[![React](https://img.shields.io/badge/React-19.2-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24.15-5fa04e?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh)
[![mise](https://img.shields.io/badge/mise-pinned_tools-1f2937)](https://mise.jdx.dev)
[![Task](https://img.shields.io/badge/Task-runner-2563eb)](https://taskfile.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-components-111827)](https://ui.shadcn.com)
[![Radix UI](https://img.shields.io/badge/Radix_UI-primitives-161618?logo=radixui)](https://www.radix-ui.com/primitives)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/docs)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-c5f74f)](https://orm.drizzle.team)
[![Zod](https://img.shields.io/badge/Zod-validation-3068b7)](https://zod.dev)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-cache-ff4154?logo=reactquery&logoColor=white)](https://tanstack.com/query)
[![AI SDK](https://img.shields.io/badge/AI_SDK-integrations-111827)](https://ai-sdk.dev)
[![OpenAI](https://img.shields.io/badge/OpenAI-provider-412991?logo=openai&logoColor=white)](https://platform.openai.com/docs)
[![Anthropic](https://img.shields.io/badge/Anthropic-provider-d97757)](https://docs.anthropic.com)
[![Resend](https://img.shields.io/badge/Resend-email-000000?logo=resend)](https://resend.com/docs)
[![Stripe](https://img.shields.io/badge/Stripe-payments-635bff?logo=stripe&logoColor=white)](https://docs.stripe.com)
[![Sentry](https://img.shields.io/badge/Sentry-errors-362d59?logo=sentry&logoColor=white)](https://docs.sentry.io)
[![PostHog](https://img.shields.io/badge/PostHog-analytics-f54e00?logo=posthog&logoColor=white)](https://posthog.com/docs)
[![Biome](https://img.shields.io/badge/Biome-v2-60a5fa?logo=biome&logoColor=white)](https://biomejs.dev)
[![Vitest](https://img.shields.io/badge/Vitest-unit_tests-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2ead33?logo=playwright&logoColor=white)](https://playwright.dev)

Nexa is a Next.js 16 App Router app for a modern full-stack product workflow. It uses React 19, TypeScript, Tailwind CSS v4, Supabase Postgres, Drizzle, AI SDK providers, transactional email, payments, analytics, Biome, Vitest, and Playwright.

## Requirements

- macOS or Linux.
- [mise](https://mise.jdx.dev/installing-mise.html) for pinned Node.js, Bun, Task, and GitHub CLI versions.
- [Docker](https://docs.docker.com/get-started/get-docker/) for local Supabase.

This repo assumes your shell activates mise so direct commands like `task dev` use the pinned project tools. For zsh, add this near the end of `~/.zshrc` after other PATH setup such as Bun or NVM, then open a new terminal:

```bash
eval "$(mise activate zsh)"
```

The setup script can install `mise` for you on macOS when Homebrew is available. On Linux, install `mise` first and rerun the script.

## Initialize Locally

```bash
./scripts/setup.sh
```

The script installs pinned tools, creates `.env.local` from `.env.example` when needed, installs Bun dependencies, and installs Playwright browsers. It does not overwrite an existing `.env.local`.

Start the app:

```bash
task dev
```

Open [http://localhost:3000](http://localhost:3000).

If `task --version` does not match the version in `mise.toml`, restart your shell and confirm mise activation is loaded.

## Local Supabase

Docker must be running before starting Supabase.

```bash
task db:start
```

Copy the local API URL, anon key, and database URL from the Supabase CLI output into `.env.local`. Typical local values use these ports:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Useful database tasks:

```bash
task db:reset
task db:types
task db:introspect
task db:stop
```

Supabase migrations are the source of truth for schema changes. Drizzle is configured for type-safe queries and introspection, not for owning migrations.

## Common Tasks

```bash
task              # list tasks
task check        # Biome checks
task typecheck    # Next route types + TypeScript
task test:run     # unit tests
task verify:all   # full local validation
```

Forward extra arguments with `--`, for example:

```bash
task email:dev -- --port 3001
```

## Project Structure

```text
src/app/                 Next.js App Router routes, layout, and global CSS
src/components/ui/       shadcn/ui-owned primitives
src/db/                  Drizzle schema placeholder and generated DB types
src/env.ts               Typed environment variable contract
src/lib/                 Shared utilities
src/test/                Vitest setup
e2e/                     Playwright tests
emails/                  React Email templates
supabase/                Supabase local config and migrations
```

## Notes for Agents

- Read [AGENTS.md](./AGENTS.md) before changing code.
- This project uses Next.js 16. Use `node_modules/next/dist/docs/` as the local source of truth for framework behavior.
- Prefer existing Task tasks over ad hoc commands.
- Do not commit secrets. `.env.local` is ignored; `.env.example` is the committed contract.
