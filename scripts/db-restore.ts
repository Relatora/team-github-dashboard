/**
 * Restore a dump produced by db-backup.
 *
 *   npm run db:restore -- "C:\AWrk\Docker\team-github-dashboard-app\tgd-20260901-123148.dump"
 *   npm run db:restore -- --latest
 *   npm run db:restore -- --latest --into tgd_scratch
 *
 * THIS REPLACES THE TARGET DATABASE. Every table in the dump is dropped and
 * recreated, so anything scanned since the dump is lost. Pass --into to restore
 * somewhere else, which is the safe way to inspect a backup or to check that one
 * is actually restorable.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import "../lib/config/load-env";
import { prompt } from "./prompt";

const DEFAULT_DIR = "C:\\AWrk\\Docker\\team-github-dashboard-app";
const CONTAINER = process.env.DB_CONTAINER ?? "tgd-db";
const DB_USER = process.env.DB_USER ?? "tgd";
const DB_NAME = process.env.DB_NAME ?? "tgd";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function latestDump(dir: string): Promise<string> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".dump"));
  if (!files.length) throw new Error(`No .dump files in ${dir}`);

  const withTimes = await Promise.all(
    files.map(async (f) => ({ f, t: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withTimes.sort((a, b) => b.t - a.t);
  return path.join(dir, withTimes[0].f);
}

function run(command: string, args: string[], stdinFile?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdinFile ? "pipe" : "ignore", "inherit", "inherit"],
    });
    if (stdinFile && child.stdin) createReadStream(stdinFile).pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

async function main() {
  const dir = process.env.BACKUP_DIR ?? DEFAULT_DIR;
  const positional = process.argv.slice(2).find((a) => !a.startsWith("--") && a.endsWith(".dump"));
  const file = process.argv.includes("--latest") ? await latestDump(dir) : positional;

  if (!file) {
    console.error('Usage: npm run db:restore -- "<file.dump>"   or   npm run db:restore -- --latest');
    process.exit(1);
  }

  const target = arg("into") ?? DB_NAME;
  const { size } = await stat(file);
  console.log(`Restoring ${path.basename(file)} (${(size / 1024).toFixed(0)} KB) into "${target}".`);

  if (target === DB_NAME) {
    // Only guard the real database. Restoring into a scratch copy is the
    // recommended way to verify a backup and should not need a ceremony.
    console.log(`\nThis REPLACES every table in "${target}". Anything scanned since the dump is lost.`);
    const answer = await prompt(`Type the database name to continue: `);
    if (answer !== target) {
      console.log("Cancelled.");
      process.exit(1);
    }
  } else {
    // createdb fails when it already exists, which is fine: reuse it.
    await run("docker", ["exec", CONTAINER, "createdb", "-U", DB_USER, target]).catch(() => {});
  }

  await run(
    "docker",
    ["exec", "-i", CONTAINER, "pg_restore", "-U", DB_USER, "-d", target, "--no-owner", "--clean", "--if-exists"],
    file
  );

  console.log(`\nRestored into "${target}".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
