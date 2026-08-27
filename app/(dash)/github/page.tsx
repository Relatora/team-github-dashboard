import { requireUser } from "@/lib/auth/guard";
import { Dashboard } from "@/components/github/dashboard";

export const metadata = { title: "GitHub Work Dashboard" };

export default async function GitHubPage() {
  const user = await requireUser();
  return <Dashboard user={user} />;
}
