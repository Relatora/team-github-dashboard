/**
 * Dump the database to a real file on the host.
 *
 *   npm run db:backup
 *   npm run db:backup -- --out D:\somewhere-else
 *
 * The named Docker volume already survives crashes, restarts, and container
 * recreation. What it does NOT survive is `docker compose down -v`, a
 * `docker volume prune`, or a Docker Desktop reset, because it still lives
 * inside Docker's own storage. This writes outside it.
 *
 * Custom format (-Fc), because it restores selectively and compresses, unlike
 * a plain SQL dump.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import "../lib/config/load-env";

/** Where backups land. The container is addressed by name, not by connection string. */
const DEFAULT_DIR = "C:\\AWrk\\Docker\\team-github-dashboard-app";
const CONTAINER = process.env.DB_CONTAINER ?? "tgd-db";
const DB_USER = process.env.DB_USER ?? "tgd";
const DB_NAME = process.env.DB_NAME ?? "tgd";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Local time, filename safe, sorts chronologically as text. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

async function main() {
  const dir = arg("out") ?? process.env.BACKUP_DIR ?? DEFAULT_DIR;
  await mkdir(dir, { recursive: true });

  const file = path.join(dir, `tgd-${stamp()}.dump`);
  console.log(`Dumping ${DB_NAME} from container ${CONTAINER} to ${file}`);

  await new Promise<void>((resolve, reject) => {
    // pg_dump runs inside the container, so no Postgres client tools are
    // needed on the host and the version always matches the server.
    const child = spawn("docker", ["exec", CONTAINER, "pg_dump", "-U", DB_USER, "-d", DB_NAME, "-Fc"], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    const out = createWriteStream(file);
    child.stdout.pipe(out);

    child.on("error", reject);
    child.on("close", (code) => {
      // Resolve on the file being closed, not on the process exiting, or a
      // large dump can be truncated by a process that finishes writing to the
      // pipe before the disk write drains.
      out.on("close", () => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`))));
      out.end();
    });
  });

  const { size } = await stat(file);
  if (size === 0) {
    // An empty file is worse than no file: it looks like a backup.
    throw new Error("The dump is empty. Is the container running and the database name correct?");
  }

  console.log(`Wrote ${(size / 1024).toFixed(0)} KB.`);
  console.log(`Restore with: npm run db:restore -- "${file}"`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\nIs the database running? Try: docker compose up -d db`);
  process.exit(1);
});
