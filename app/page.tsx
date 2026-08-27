import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Team GitHub Dashboard</h1>
      <p className="text-muted-foreground">
        Commits across every repository and branch in your organization, with generated and vendored
        files filtered out, work categorized, and a report you can hand to leadership.
      </p>
      <div>
        <Button asChild>
          <Link href="/github">Open the dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
