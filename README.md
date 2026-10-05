# Nexa

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?logo=nextdotjs)](https://nextjs.org/docs)
[![React](https://img.shields.io/badge/React-19.2-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24.21-5fa04e?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun-1.4-000000?logo=bun&logoColor=white)](https://bun.sh)
[![mise](https://img.shields.io/badge/mise-pinned_tools-1f2937)](https://mise.jdx.dev)
[![Task](https://img.shields.io/badge/Task-runner-2563eb)](https://taskfile.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-components-111827)](https://ui.shadcn.com)
[![Radix UI](https://img.shields.io/badge/Radix_UI-primitives-161618?logo=radixui)](https://www.radix-ui.com/primitives)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/docs)
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
[![prek](https://img.shields.io/badge/prek-git_hooks-111827)](https://github.com/j178/prek)
[![Vitest](https://img.shields.io/badge/Vitest-unit_tests-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2ead33?logo=playwright&logoColor=white)](https://playwright.dev)

Nexa is a Next.js 16 App Router app for a modern full-stack product workflow. It uses React 19, TypeScript, Tailwind CSS v4, Supabase Postgres, AI SDK providers, transactional email, payments, analytics, Biome, Vitest, and Playwright.

## Requirements

- macOS or GNU/Linux compatible with the pinned toolchain. The Linux lock uses
  Node's official glibc artifacts; Alpine/musl environments need a separate tool
  configuration. See [Node's supported platforms](https://github.com/nodejs/node/blob/v24.21.0/BUILDING.md#platform-list).
- [Docker](https://docs.docker.com/get-started/get-docker/) for the local Supabase database.

## Initialize Locally

```bash
./scripts/setup.sh
```

Start Docker, then start the local stack:

```bash
task dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database Schema

Supabase SQL migrations are the source of truth for schema changes. After changing migrations, regenerate TypeScript database types with `task db:types`.

## Common Tasks

This project uses [Task](https://taskfile.dev) for local commands. Run `task` to list available tasks.

## GitHub Issues

Agents use the project-scoped `github-issues` skill with this repository's issue
policy and templates. See [skill provenance and updates](docs/github-issues.md).

## Dependency Updates

Renovate groups routine updates into one weekly PR. GitHub merges it after the
required CI and security checks pass. Major upgrades wait in the Dependency
Dashboard until requested and stay manual to merge. See
[setup and failed-update recovery](docs/dependency-updates.md).

## Project Skill Updates

Weekly skill updates are prepared as one PR for manual review and merging. See
[setup, candidate review, and manual runs](docs/skill-updates.md).

## Agent Pull Requests

When using Nexa as a template, agent PRs default to your own authenticated Git and
`gh` setup. Run `task agents:publication` to inspect this clone's destination and
mode. You do not need access to Briko or any GitHub App.

A private GitHub App publisher is optional and selected through local Git
configuration, which is not copied with the template. Canonical Nexa explicitly
requires the owner's private Brikosi App (`brikosi[bot]`), called Briko; **SI** means
**Super Intelligence**. The owner can reuse it for selected personal repositories.
Publication preserves commit authorship. See
[mode selection, publication, and protected App setup](docs/agent-publication.md).
