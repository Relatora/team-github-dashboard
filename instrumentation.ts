/**
 * Server startup hook. Next calls this once per server process.
 *
 * The only job here is starting the scan scheduler, and only in the Node
 * runtime: the Edge runtime has no timers that outlive a request and no
 * database driver, so importing the runner there would fail at build time.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the Edge bundle never has to resolve the database
  // driver this pulls in transitively.
  const { startScheduler } = await import("@/lib/schedule/runner");
  startScheduler();
}
