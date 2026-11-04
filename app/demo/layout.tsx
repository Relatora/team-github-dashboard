import type { ReactNode } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { GitBranch } from "lucide-react";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/toaster";

/**
 * The public demo. Deliberately outside app/(dash): this must never go
 * through app/(dash)/layout.tsx's requireUser(), because with AUTH_ENABLED
 * set to false that call succeeds trivially and "public" would become
 * indistinguishable from "admin, locally, with the switch off". No auth call
 * exists anywhere in this subtree, so there is nothing for AUTH_ENABLED to
 * accidentally gate.
 *
 * middleware.ts's matcher is scoped to /github/:path*, so it never touches
 * this route either - confirm that stays true before widening it.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <GitBranch className="size-5" />
              <span className="hidden sm:inline">Team GitHub Dashboard</span>
            </Link>
            <span className="flex items-center gap-1.5 rounded-full border border-sky-500/40 px-2.5 py-1 text-xs text-sky-500">
              <Sparkles className="size-3.5" />
              Live demo, synthetic data
            </span>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 pb-10 pt-4 sm:px-6">{children}</main>
        <Toaster />
      </div>
    </QueryProvider>
  );
}
