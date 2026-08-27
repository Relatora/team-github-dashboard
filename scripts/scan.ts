/**
 * Run a scan from the command line.
 *
 *   npm run scan
 *   npm run scan -- --users Relatora,Hempie31 --start 2026-08-01 --end 2026-08-27
 *   npm run scan -- --rebuild-cache
 *
 * This is what a scheduled job runs (Task Scheduler, cron, a container). It
 * calls exactly the same code as the "Refresh data" button, so a scheduled scan
 * and a manual one cannot drift apart.
 */
import "../lib/config/load-env";
import { applyScanConfigOverride } from "../lib/config";
import { runScan } from "../lib/github/run-scan";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rebuild = process.argv.includes("--rebuild-cache");

async function main() {
  await applyScanConfigOverride();
  const started = Date.now();

  const outcome = await runScan(
    {
      users: arg("users")?.split(",").map((u) => u.trim()).filter(Boolean),
      startDate: arg("start"),
      endDate: arg("end"),
      // --rebuild-cache re-lists organization repositories as well as branches.
      // Worth it after repositories are added or renamed, and wasteful otherwise.
      cache: rebuild ? { repos: "scan", branches: "scan" } : undefined,
    },
    (message) => console.log(message)
  );

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n${outcome.counts.commits} commits, ${outcome.counts.issues} issues, ` +
      `${outcome.counts.repositories} repositories, ${outcome.counts.enriched} enriched ` +
      `in ${seconds}s using ${outcome.apiRequests} API requests.`
  );

  for (const warning of outcome.warnings) console.warn(`Warning: ${warning}`);

  // Exit 2 for an incomplete run so a scheduler can tell "partial, run again
  // when the quota resets" apart from both success and hard failure.
  process.exit(outcome.incomplete ? 2 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
