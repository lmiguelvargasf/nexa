# Nexa

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/docs)
[![React](https://img.shields.io/badge/React-19.2-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24.16-5fa04e?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh)
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

- macOS or Linux.
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
