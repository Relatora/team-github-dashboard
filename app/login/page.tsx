import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guard";
import { isAuthEnabled } from "@/lib/config/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in - Team GitHub Dashboard" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // With authentication switched off there is nothing to sign in to, and a
  // login form that cannot fail is worse than no form at all.
  if (!isAuthEnabled()) redirect("/github");
  if (await getSessionUser()) redirect("/github");

  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Team GitHub Dashboard</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to continue.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
