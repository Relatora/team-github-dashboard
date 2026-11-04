import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Filter,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/home/animated-counter";
import { getDemoStore } from "@/lib/store";

/**
 * Real numbers from the live demo dataset, not marketing copy. Matches the
 * repository convention (CLAUDE.md: "Numbers quoted in documentation come
 * from real runs, never estimates") - the same rule applied to this page.
 *
 * Degrades quietly to null if the demo dataset has not been seeded yet (a
 * fresh checkout before `npm run dev`'s predev hook has run), rather than
 * failing the whole homepage over a missing highlight strip.
 */
async function getDemoHighlights() {
  try {
    const store = getDemoStore();
    const roster = await store.getRoster();
    const handles = roster.map((r) => r.handle);
    if (!handles.length) return null;

    const [cleaned, raw] = await Promise.all([
      store.getMetrics({ users: handles, calc: "cleaned" }),
      store.getMetrics({ users: handles, calc: "raw" }),
    ]);

    return {
      commits: cleaned.kpis.commits,
      contributors: cleaned.kpis.contributors,
      repos: cleaned.kpis.repos,
      cleanedLines: cleaned.kpis.additions,
      rawLines: raw.kpis.additions,
    };
  } catch {
    return null;
  }
}

const FEATURES = [
  {
    icon: GitBranch,
    title: "Every branch, every repo",
    body: "Walks the full commit history across every repository and branch your token can see, including work that never left a feature branch.",
  },
  {
    icon: Filter,
    title: "Cleaned vs. raw, side by side",
    body: "Generated files, vendored code, and merge noise are filtered out and stored alongside the raw numbers, so you can show either one.",
  },
  {
    icon: FileText,
    title: "A report leadership can read",
    body: "Commits are categorized into features, fixes, and refactors, and exported as a narrative Markdown or PDF report, not a spreadsheet.",
  },
];

export default async function Home() {
  const stats = await getDemoHighlights();
  const noiseMultiple =
    stats && stats.cleanedLines > 0 ? Math.round((stats.rawLines / stats.cleanedLines) * 10) / 10 : null;

  return (
    <main className="relative overflow-hidden">
      {/* Decorative background: transform-only CSS animation, no client JS. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-drift absolute -left-32 -top-32 size-[28rem] rounded-full bg-primary/20 blur-3xl" />
        <div
          className="animate-drift absolute -right-32 top-40 size-[24rem] rounded-full bg-emerald-500/15 blur-3xl"
          style={{ animationDelay: "-8s" }}
        />
      </div>

      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-6 py-16">
        <div className="animate-fade-up flex items-center gap-2 self-start rounded-full border border-sky-500/40 bg-sky-500/5 px-3 py-1 text-xs font-medium text-sky-500">
          <Sparkles className="size-3.5" />
          Live demo, no sign-up or GitHub token required
        </div>

        <div>
          <h1
            className="animate-fade-up text-4xl font-semibold tracking-tight sm:text-5xl"
            style={{ "--fade-delay": "80ms" } as CSSProperties}
          >
            Measure real engineering work,
            <br className="hidden sm:block" /> not GitHub&apos;s noisy version of it.
          </h1>
          <p
            className="animate-fade-up mt-4 max-w-2xl text-lg text-muted-foreground"
            style={{ "--fade-delay": "160ms" } as CSSProperties}
          >
            Commits across every repository and branch in your organization, with generated and
            vendored files filtered out, work categorized, and a report you can hand to leadership.
          </p>
        </div>

        <div
          className="animate-fade-up flex flex-wrap items-center gap-3"
          style={{ "--fade-delay": "240ms" } as CSSProperties}
        >
          <Button asChild size="lg" className="group">
            <Link href="/demo">
              <PlayCircle />
              Try the live demo
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/github">Open your dashboard</Link>
          </Button>
        </div>

        {stats && (
          <div
            className="animate-fade-up flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card/60 px-5 py-4 text-sm"
            style={{ "--fade-delay": "320ms" } as CSSProperties}
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <GitCommitHorizontal className="size-4" />
              In the live demo
            </div>
            <Stat value={stats.commits} label="commits" />
            <Stat value={stats.repos} label="repositories" />
            <Stat value={stats.contributors} label="contributors" />
            {noiseMultiple !== null && (
              <div className="tabular-nums">
                <span className="font-semibold text-foreground">
                  <AnimatedCounter value={noiseMultiple} suffix="x" />
                </span>{" "}
                <span className="text-muted-foreground">more raw lines than cleaned</span>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="animate-fade-up group rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
              style={{ "--fade-delay": `${400 + i * 90}ms` } as CSSProperties}
            >
              <Icon className="size-5 text-primary transition-transform duration-300 group-hover:scale-110" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <div
          className="animate-fade-up flex items-center gap-2 text-sm text-muted-foreground"
          style={{ "--fade-delay": "700ms" } as CSSProperties}
        >
          Curious how it looks with real data flowing through it?
          <Link href="/demo" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            See the live demo <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="tabular-nums">
      <span className="font-semibold text-foreground">
        <AnimatedCounter value={value} />
      </span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
