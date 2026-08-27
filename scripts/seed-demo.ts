/**
 * Fill the database with a plausible synthetic dataset.
 *
 *   npm run seed-demo
 *   npm run seed-demo -- --months 18 --clear
 *
 * This matters more than it looks. Without it, evaluating the product requires
 * pointing it at a real organization and handing it a GitHub token first, which
 * is a large ask before anyone has seen a single screen. With it, a fresh clone
 * shows a full dashboard in one command.
 *
 * The data is obviously synthetic and should never be mistaken for real: the
 * repositories and people are named as examples.
 */
import "dotenv/config";
import { categorize } from "../lib/github/categorize";
import { STATS_VERSION } from "../lib/github/stats";
import { createPool } from "../lib/db/pool";
import { upsertCommits } from "../lib/db/repositories/commits";
import { recordRun, upsertIssues, type ItemRow } from "../lib/db/repositories/items";
import { commits as commitsTable, issues as issuesTable } from "../lib/db/schema";
import type { NewCommitRow } from "../lib/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PEOPLE = [
  { login: "demo-avery", name: "Avery Lin", email: "avery@example.com", weight: 4 },
  { login: "demo-jordan", name: "Jordan Okafor", email: "jordan@example.com", weight: 3 },
  { login: "demo-sam", name: "Sam Petrov", email: "sam@example.com", weight: 2 },
  { login: "demo-riley", name: "Riley Chen", email: "riley@example.com", weight: 1 },
];

// Includes a client and server pair so the project consolidation is visible in
// the seeded dashboard rather than only in the code.
const REPOS = [
  "example-org/platform-client",
  "example-org/platform-server",
  "example-org/billing-service",
  "example-org/design-system",
  "example-org/data-pipeline",
  "example-org/mobile-app",
];

const MESSAGES = [
  "add invoice export to the billing screen",
  "fix rounding error on partial refunds",
  "refactor the scheduler into smaller units",
  "remove the deprecated v1 webhook handler",
  "bump dependencies and pin the lockfile",
  "document the deployment runbook",
  "improve query performance on the reports page",
  "handle an empty response from the pricing API",
  "add retry with backoff to the sync worker",
  "clean up unused feature flags",
  "update the design tokens for dark mode",
  "correct the timezone handling in exports",
  "Merge branch 'develop' into main",
  "introduce pagination on the audit log",
  "simplify the auth middleware",
  "add integration tests for the webhook path",
];

/**
 * Deterministic pseudo-random source.
 *
 * Seeded rather than Math.random so two runs produce identical data. A demo
 * whose numbers move every time it is regenerated is useless for a screenshot
 * or for comparing a change against a baseline.
 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function main() {
  const months = Number(arg("months") ?? 12);
  const clear = process.argv.includes("--clear");
  const random = makeRandom(20260827);

  const { db, close } = createPool();

  try {
    if (clear) {
      // Only touches the demo rows, so seeding a database that also holds real
      // scanned data cannot destroy it.
      await db.delete(commitsTable);
      await db.delete(issuesTable);
      console.log("Cleared existing commits and issues.");
    }

    const weighted = PEOPLE.flatMap((p) => Array<typeof p>(p.weight).fill(p));
    const commits: NewCommitRow[] = [];
    const now = new Date();

    for (let monthsAgo = months - 1; monthsAgo >= 0; monthsAgo--) {
      // A seasonal curve, so "Commits Over Time" is not a flat line.
      const base = 40 + Math.round(Math.sin(monthsAgo / 2) * 18);
      const count = Math.max(8, base + Math.round(random() * 25));

      for (let i = 0; i < count; i++) {
        const person = weighted[Math.floor(random() * weighted.length)];
        const repo = REPOS[Math.floor(random() * REPOS.length)];
        const message = MESSAGES[Math.floor(random() * MESSAGES.length)];

        const date = new Date(now);
        date.setMonth(date.getMonth() - monthsAgo);
        date.setDate(1 + Math.floor(random() * 27));
        date.setHours(9 + Math.floor(random() * 9), Math.floor(random() * 60), 0, 0);

        const isMerge = message.startsWith("Merge");
        // A merge contributes zero cleaned lines while keeping a large raw
        // diff, which is exactly the contrast the Cleaned/Raw toggle exists to
        // show. Seeding it flat would hide the product's main argument.
        const cleanedAdds = isMerge ? 0 : Math.floor(random() * 240) + 5;
        const cleanedDels = isMerge ? 0 : Math.floor(random() * 120);
        const noise = Math.floor(random() * 3000);

        const sha = Array.from({ length: 40 }, () =>
          "0123456789abcdef"[Math.floor(random() * 16)]
        ).join("");

        commits.push({
          sha,
          repository: repo,
          message,
          committedAt: date,
          authorLogin: person.login,
          authorName: person.name,
          authorEmail: person.email,
          category: categorize(message),
          url: `https://github.com/${repo}/commit/${sha}`,
          apiUrl: `https://api.github.com/repos/${repo}/commits/${sha}`,
          isMerge,
          additions: cleanedAdds,
          deletions: cleanedDels,
          filesChanged: isMerge ? 0 : Math.floor(random() * 12) + 1,
          additionsRaw: cleanedAdds + noise,
          deletionsRaw: cleanedDels + Math.floor(noise / 3),
          filesChangedRaw: Math.floor(random() * 40) + 1,
          statsVersion: STATS_VERSION,
        });
      }
    }

    const written = await upsertCommits(db, commits);

    const issues: ItemRow[] = Array.from({ length: 60 }, (_, i) => {
      const person = weighted[Math.floor(random() * weighted.length)];
      const repo = REPOS[Math.floor(random() * REPOS.length)];
      const created = new Date(now);
      created.setMonth(created.getMonth() - Math.floor(random() * months));
      return {
        id: `${repo}#${1000 + i}`,
        type: "issue",
        number: 1000 + i,
        title: MESSAGES[Math.floor(random() * MESSAGES.length)],
        state: random() > 0.4 ? "closed" : "open",
        repository: repo,
        authorLogin: person.login,
        createdAt: created,
        updatedAt: created,
        closedAt: null,
        labels: "",
        url: `https://github.com/${repo}/issues/${1000 + i}`,
      };
    });
    const issuesWritten = await upsertIssues(db, issues);

    await recordRun(db, {
      periodStart: commits[0]?.committedAt ?? null,
      periodEnd: now,
      users: PEOPLE.map((p) => p.login),
      displayNames: Object.fromEntries(PEOPLE.map((p) => [p.login, p.name])),
      scope: { organizations: ["example-org"], repositories: [] },
      counts: { commits: written, issues: issuesWritten, repositories: REPOS.length, enriched: written },
      incomplete: false,
      message: "Synthetic demo data from scripts/seed-demo.ts",
    });

    console.log(
      `Seeded ${written} commits and ${issuesWritten} issues across ${REPOS.length} ` +
        `repositories and ${PEOPLE.length} people, over ${months} months.`
    );
    console.log("These rows are synthetic. Use --clear before importing real data.");
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
