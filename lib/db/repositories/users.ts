import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users, type UserRow } from "@/lib/db/schema";
import type { Role } from "@/lib/auth/roles";

/** Emails are matched case insensitively, and stored lowercased. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  name?: string;
  passwordHash: string;
  roles: Role[];
}): Promise<UserRow> {
  const [row] = await getDb()
    .insert(users)
    .values({
      email: normalizeEmail(input.email),
      name: input.name ?? "",
      passwordHash: input.passwordHash,
      roles: input.roles,
    })
    .returning();
  return row;
}

export async function setPassword(email: string, passwordHash: string): Promise<boolean> {
  const rows = await getDb()
    .update(users)
    .set({ passwordHash })
    .where(eq(users.email, normalizeEmail(email)))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function setRoles(email: string, roles: Role[]): Promise<boolean> {
  const rows = await getDb()
    .update(users)
    .set({ roles })
    .where(eq(users.email, normalizeEmail(email)))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function recordLogin(id: number): Promise<void> {
  await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
}

export async function listUsers(): Promise<UserRow[]> {
  return getDb().select().from(users).orderBy(users.email);
}

export async function countUsers(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}
