import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Code2Icon,
  DatabaseIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const readinessItems = [
  {
    label: "Typed app surface",
    detail: "Next.js 16 App Router, route typegen, strict TypeScript.",
    icon: Code2Icon,
  },
  {
    label: "Validation path",
    detail: "Biome, Vitest, production build, and Playwright are wired.",
    icon: CheckCircle2Icon,
  },
  {
    label: "Service-ready",
    detail:
      "Supabase, email, payments, analytics, AI, and errors have env contracts.",
    icon: DatabaseIcon,
  },
  {
    label: "Operational hooks",
    detail:
      "Health checks, PR templates, CI, git hooks, and pinned tools are in place.",
    icon: ShieldCheckIcon,
  },
];

export default function Home() {
  return (
    <main className="flex min-h-full flex-1 bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 sm:px-10 lg:px-12">
        <header className="flex flex-col gap-6 border-border border-b pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-3xl flex-col gap-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <ActivityIcon data-icon="inline-start" />
              <span>Nexa template</span>
            </div>
            <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">
              A pragmatic base for real products.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground leading-8">
              Start with the boring parts already shaped: typed framework APIs,
              pinned local tools, service contracts, validation, and review
              discipline.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/api/health">
              Health check
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          {readinessItems.map((item) => {
            const Icon = item.icon;

            return (
              <article
                className="flex min-h-36 gap-4 rounded-md border border-border bg-card p-5 text-card-foreground"
                key={item.label}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Icon />
                </div>
                <div className="flex flex-col gap-2">
                  <h2 className="font-medium text-base">{item.label}</h2>
                  <p className="text-muted-foreground text-sm leading-6">
                    {item.detail}
                  </p>
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid gap-4 border-border border-t pt-8 md:grid-cols-[1fr_1fr_1fr]">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Local loop</span>
            <strong className="font-medium">task dev</strong>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Pre-PR gate</span>
            <strong className="font-medium">task verify</strong>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Full gate</span>
            <strong className="font-medium">task verify:all</strong>
          </div>
        </section>
      </div>
    </main>
  );
}
