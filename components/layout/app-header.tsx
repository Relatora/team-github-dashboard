"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
// lucide dropped its brand icons, and embedding the GitHub mark would put a
// third party trademark in the chrome of a product that is not theirs.
import { GitBranch, LogOut, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionUser } from "@/lib/auth/roles";

export function AppHeader({ user, authEnabled }: { user: SessionUser; authEnabled: boolean }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <Link href="/github" className="flex items-center gap-2 font-semibold">
          <GitBranch className="size-5" />
          <span className="hidden sm:inline">Team GitHub Dashboard</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {/* A deployment with authentication switched off should look like one,
              rather than quietly presenting itself as a signed-in session. */}
          {!authEnabled && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-destructive/40 px-2.5 py-1 text-xs text-destructive"
              title="AUTH_ENABLED is false. Anyone who can reach this server has full access."
            >
              <ShieldOff className="size-3.5" />
              Authentication disabled
            </span>
          )}

          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user.name || user.email}
          </span>

          <ThemeToggle />

          {authEnabled && (
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
