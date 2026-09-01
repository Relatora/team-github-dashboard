import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/guard";
import { isAuthEnabled } from "@/lib/config/env";
import { QueryProvider } from "@/components/providers/query-provider";
import { AppHeader } from "@/components/layout/app-header";
import { Toaster } from "@/components/ui/toaster";

/**
 * Never prerendered, for the same reason as the login page: with AUTH_ENABLED
 * off, requireUser returns a synthetic user without touching cookies, so this
 * subtree becomes prerenderable and would freeze the switch at build time.
 */
export const dynamic = "force-dynamic";

/**
 * Everything inside this route group is behind requireUser, so a new page is
 * protected by existing here rather than by remembering to add a check.
 *
 * This is the real gate. middleware.ts only looks for a cookie; the token is
 * verified here.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <QueryProvider>
      <div className="flex min-h-screen flex-col">
        <AppHeader user={user} authEnabled={isAuthEnabled()} />
        <main className="flex-1 px-4 pb-10 pt-4 sm:px-6">{children}</main>
        <Toaster />
      </div>
    </QueryProvider>
  );
}
