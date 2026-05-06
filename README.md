# Nexa

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/docs)
[![React](https://img.shields.io/badge/React-19.2-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/docs)
[![Biome](https://img.shields.io/badge/Biome-v2-60a5fa?logo=biome&logoColor=white)](https://biomejs.dev)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2ead33?logo=playwright&logoColor=white)](https://playwright.dev)

Nexa is a Next.js App Router application scaffolded for a modern full-stack product workflow: React Server Components by default, strict TypeScript, Tailwind CSS v4, shadcn/ui primitives, Supabase Postgres, Drizzle queries, typed environment validation, AI SDK integrations, transactional email, payments, analytics, and a testable agent-friendly project structure.

## Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Framework | [Next.js 16](https://nextjs.org/docs) | App Router, Server Components, Server Actions, and production builds. |
| UI runtime | [React 19](https://react.dev) | Component model for Server and Client Components. |
| Language | [TypeScript](https://www.typescriptlang.org) | Strict static typing across app, config, and tests. |
| Package manager | [Bun](https://bun.sh/docs) | Dependency installation and script runner. |
| Runtime | [Node.js](https://nodejs.org/en) | Next.js server runtime, pinned by `mise.toml` and `mise.lock`. |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/docs) | Utility-first CSS with the native CSS engine. |
| Components | [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://www.radix-ui.com/primitives) | Copy-owned accessible UI primitives. |
| Icons | [lucide-react](https://lucide.dev/guide/packages/lucide-react) | Tree-shakeable icon set. |
| Database | [Supabase Postgres](https://supabase.com/docs/guides/database) | Managed Postgres, local development, Auth, Storage, Realtime, and pgvector-ready data layer. |
| Auth helpers | [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs) | Cookie-aware SSR auth helpers for Next.js. |
| Queries | [Drizzle ORM](https://orm.drizzle.team/docs/overview) + [postgres.js](https://github.com/porsager/postgres) | Type-safe SQL builder and Postgres driver. |
| Validation | [Zod](https://zod.dev) | Runtime schema validation for actions, forms, env, and AI tools. |
| Typed env | [@t3-oss/env-nextjs](https://env.t3.gg/docs/nextjs) | Build-time and runtime environment variable validation. |
| Forms | [React Hook Form](https://react-hook-form.com) + [resolvers](https://github.com/react-hook-form/resolvers) | Performant form state with Zod validation. |
| Client cache | [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) | Client-side server-state cache for cases where RSC is not enough. |
| AI | [Vercel AI SDK](https://ai-sdk.dev/docs) | Streaming, tool calls, structured output, and provider-agnostic AI integrations. |
| AI providers | [Anthropic](https://docs.anthropic.com) + [OpenAI](https://platform.openai.com/docs) | Provider packages for AI SDK model access. |
| Email | [Resend](https://resend.com/docs) + [React Email](https://react.email/docs) | Transactional email and JSX email templates. |
| Payments | [Stripe](https://docs.stripe.com) | Server SDK, browser loader, and React Elements. |
| Error tracking | [Sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/) | Server and client error reporting and performance monitoring. |
| Product analytics | [PostHog](https://posthog.com/docs) | Events, funnels, feature flags, and session replay. |
| Lint/format | [Biome](https://biomejs.dev/guides/getting-started/) | Fast formatter, linter, and import organizer. |
| Unit tests | [Vitest](https://vitest.dev) + [Testing Library](https://testing-library.com/docs/react-testing-library/intro/) | Unit and component tests in jsdom. |
| E2E tests | [Playwright](https://playwright.dev/docs/intro) | Cross-browser end-to-end tests. |
| Agent context | [AGENTS.md](./AGENTS.md) + [CLAUDE.md](./CLAUDE.md) | Local instructions for AI coding agents. |

## Requirements

- [mise](https://mise.jdx.dev/installing-mise.html) for project tools and tasks.
- [Docker](https://docs.docker.com/get-started/get-docker/) for local Supabase.

mise installs and activates the pinned Node.js, Bun, and GitHub CLI versions from `mise.toml`.

For interactive shells, activate mise once using the shell integration from the mise docs. You can also run project commands explicitly with `mise run`.

## Initialize Locally

1. Install pinned project tools:

```bash
mise install
```

2. Initialize the local project:

```bash
mise run setup
```

This installs Bun dependencies, creates `.env.local` from `.env.example` when missing, and installs Playwright browsers.

3. Start the app:

```bash
mise run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Local Supabase

Docker must be running before starting Supabase.

```bash
mise run db:start
```

After Supabase starts, copy the local API URL, anon key, and database URL from the CLI output into `.env.local`.

Typical local values use these ports:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Useful database commands:

```bash
mise run db:reset
mise run db:types
mise run db:introspect
mise run db:stop
```

Use Supabase migrations as the source of truth for schema changes. Drizzle is configured for type-safe queries and introspection, not for owning migrations.

## Email Preview

React Email templates live in `emails/`.

```bash
mise run email:dev
```

Open [http://localhost:3001](http://localhost:3001).

## Scripts

| Command | Description |
| --- | --- |
| `mise run setup` | Install dependencies, initialize `.env.local`, and install Playwright browsers. |
| `mise run dev` | Start the Next.js development server. |
| `mise run build` | Create a production build. |
| `mise run start` | Start the production server after `build`. |
| `mise run check` | Run Biome formatting, linting, and import checks. |
| `mise run check:write` | Apply safe Biome fixes. |
| `mise run format` | Format the repository with Biome. |
| `mise run lint` | Run Biome lint rules only. |
| `mise run typecheck` | Generate Next route types and run TypeScript with `noEmit`. |
| `mise run test` | Run Vitest once. |
| `mise run test:watch` | Start Vitest in watch mode. |
| `mise run e2e` | Run Playwright tests across Chromium, Firefox, and WebKit. |
| `mise run e2e:ui` | Open the Playwright UI runner. |
| `mise run db:start` | Start the local Supabase stack. |
| `mise run db:stop` | Stop the local Supabase stack. |
| `mise run db:reset` | Reset the local Supabase database. |
| `mise run db:pull` | Pull remote schema changes into Supabase migrations. |
| `mise run db:types` | Generate local Supabase TypeScript database types. |
| `mise run db:introspect` | Introspect the database with Drizzle Kit. |
| `mise run email:dev` | Start the React Email preview server on port 3001. |
| `mise run doctor` | Check the local toolchain expected by the project. |

## Validation Before Opening a PR

Run the same checks that the current scaffold was validated with:

```bash
mise run validate
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

## AI Agent Integrations

This repository commits agent-readable instructions in [AGENTS.md](./AGENTS.md) and [CLAUDE.md](./CLAUDE.md). MCP servers are configured in each developer or agent runtime, not in `package.json`.

Recommended external MCP integrations:

- [Context7 MCP](https://context7.com) for current, library-specific documentation during implementation.
- [Supabase MCP](https://supabase.com/mcp) for Supabase docs, schema inspection, SQL execution, migration visibility, and local development context.
- [Model Context Protocol](https://modelcontextprotocol.io) for the underlying tool integration standard.

Prefer read-only or project-scoped MCP settings for shared or sensitive Supabase projects.

## Notes for AI Agents

- Read [AGENTS.md](./AGENTS.md) before changing code.
- This project uses Next.js 16. The local Next docs in `node_modules/next/dist/docs/` are the preferred reference when working on framework behavior.
- Prefer existing mise tasks over ad hoc commands. If a new workflow becomes common, add a task and document it here.
- Keep Supabase migrations authoritative for schema changes. Use Drizzle for typed queries and introspection.
- Do not commit secrets. `.env.local` is ignored; `.env.example` is the committed contract.
- Run `mise run validate` before pushing.
