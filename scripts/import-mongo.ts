/**
 * One-off migration from the MongoDB database the Python tool wrote.
 *
 *   npm run import-mongo
 *   npm run import-mongo -- --uri mongodb://localhost:27017 --db TS --dry-run
 *
 * Carries existing scanned commits into Postgres so a fresh install does not
 * have to re-scan thousands of commits against the GitHub rate limit.
 *
 * `mongodb` is a devDependency only. Once this has run, both the script and the
 * dependency can be deleted.
 */
import "../lib/config/load-env";
import { MongoClient, type Document } from "mongodb";
import { categorize } from "../lib/github/categorize";
import { STATS_VERSION } from "../lib/github/stats";
import { createPool } from "../lib/db/pool";
import { upsertCommits } from "../lib/db/repositories/commits";
import { upsertIssues, type ItemRow } from "../lib/db/repositories/items";
import type { NewCommitRow } from "../lib/db/schema";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes("--dry-run");

/**
 * The Python tool wrote "" as a placeholder for a statistic it had not
 * computed. That must become NULL, not 0: NULL means "not enriched" and is what
 * the never-clobber upsert keys off. Importing it as 0 would permanently mark
 * every unenriched commit as having genuinely changed nothing.
 */
function toIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function commitFromDoc(doc: Document): NewCommitRow | null {
  // _id is the full SHA. The `sha` field holds a truncated display version, so
  // preferring it would silently key rows by twelve characters.
  const sha = String(doc._id ?? "");
  if (!sha || sha.length < 20) return null;

  const author = (doc.author ?? {}) as Record<string, unknown>;
  const message = String(doc.message ?? "");
  const additions = toIntOrNull(doc.additions);

  return {
    sha,
    repository: String(doc.repository ?? ""),
    message,
    committedAt: toDateOrNull(doc.committed_at) ?? toDateOrNull(doc.date),
    authorLogin: String(author.login ?? ""),
    authorName: String(author.name ?? ""),
    authorEmail: String(author.email ?? ""),
    // Recategorize rather than trusting the stored value. The categorizer is
    // verified byte-for-byte against the Python original, so this is identical
    // for rows that had a category and fills in rows written before the field
    // existed.
    category: doc.category ? String(doc.category) : categorize(message),
    url: String(doc.url ?? ""),
    apiUrl: String(doc.api_url ?? ""),
    isMerge: Boolean(doc.is_merge),
    additions,
    deletions: toIntOrNull(doc.deletions),
    filesChanged: toIntOrNull(doc.files_changed),
    additionsRaw: toIntOrNull(doc.additions_raw),
    deletionsRaw: toIntOrNull(doc.deletions_raw),
    filesChangedRaw: toIntOrNull(doc.files_changed_raw),
    // Only claim a version when statistics actually came across. A version
    // without numbers would make enrichment skip a commit that has none.
    statsVersion: additions === null ? null : (toIntOrNull(doc.stats_version) ?? STATS_VERSION),
  };
}

function issueFromDoc(doc: Document): ItemRow | null {
  const repository = String(doc.repository ?? "");
  const number = toIntOrNull(doc.number);
  if (!repository || number === null) return null;

  const author = (doc.author ?? {}) as Record<string, unknown>;
  return {
    id: `${repository}#${number}`,
    type: String(doc.type ?? "issue"),
    number,
    title: String(doc.title ?? ""),
    state: String(doc.state ?? ""),
    repository,
    authorLogin: String(author.login ?? ""),
    createdAt: toDateOrNull(doc.created_at),
    updatedAt: toDateOrNull(doc.updated_at),
    closedAt: toDateOrNull(doc.closed_at),
    labels: String(doc.labels ?? ""),
    url: String(doc.url ?? ""),
  };
}

async function main() {
  const uri = arg("uri", process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017")!;
  const dbName = arg("db", "TS")!;

  console.log(`Reading ${uri} database "${dbName}"`);
  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const { db, close } = createPool();

  try {
    await mongo.connect();
    const source = mongo.db(dbName);

    const commitDocs = await source.collection("github_history").find({}).toArray();
    const commits = commitDocs.map(commitFromDoc).filter((c): c is NewCommitRow => c !== null);

    const withStats = commits.filter((c) => c.additions !== null).length;
    console.log(
      `${commitDocs.length} commit documents, ${commits.length} importable, ` +
        `${withStats} already carry line statistics.`
    );

    const issueDocs = await source
      .collection("github_issues")
      .find({})
      .toArray()
      .catch(() => []);
    const issues = issueDocs.map(issueFromDoc).filter((i): i is ItemRow => i !== null);
    console.log(`${issueDocs.length} issue documents, ${issues.length} importable.`);

    if (dryRun) {
      console.log("\nDry run, nothing written. Sample commit:");
      console.log(commits[0]);
      return;
    }

    const written = await upsertCommits(db, commits);
    const issuesWritten = await upsertIssues(db, issues);
    console.log(`\nImported ${written} commits and ${issuesWritten} issues.`);
    console.log("Run `npm run enrich` to fill in statistics for anything that arrived without them.");
  } finally {
    await mongo.close();
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
