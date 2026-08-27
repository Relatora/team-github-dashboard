import { sql, type SQL } from "drizzle-orm";

/**
 * An `IN (...)` list from a JavaScript array.
 *
 * Drizzle expands an array embedded in a `sql` template into a comma separated
 * parameter LIST, not a single array parameter. That is exactly what `IN`
 * wants, and it is invalid for `= any(...)`, which needs an array on the right
 * and fails with "op ANY/ALL (array) requires array on right side".
 *
 * Both forms look equally reasonable while writing them, and the `any` version
 * type checks, builds, and only fails at runtime against a real database. This
 * helper exists so the choice is made once rather than at every call site.
 *
 * The caller must handle the empty case: `IN ()` is a syntax error in Postgres.
 */
export function inList(column: SQL | string, values: readonly (string | number)[]): SQL {
  const target = typeof column === "string" ? sql.raw(column) : column;
  return sql`${target} in ${values}`;
}
