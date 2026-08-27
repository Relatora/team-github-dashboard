/**
 * Roles.
 *
 * These replace TsDashBoardViewer, TsDeveloper, and SuperUser from the source
 * client, which resolved role codes out of the ticketing system's own database.
 * Nothing here depends on that system.
 *
 * The hierarchy is deliberately flat and additive: a role is either held or it
 * is not, and admin implies the other two. Anything more elaborate would be
 * guessing at requirements a single-team tool does not have yet.
 */
export const ROLES = ["viewer", "developer", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Roles a holder of `role` effectively has. admin implies developer implies
 * viewer, so a check for "viewer" passes for everyone signed in.
 */
const IMPLIES: Record<Role, Role[]> = {
  viewer: ["viewer"],
  developer: ["viewer", "developer"],
  admin: ["viewer", "developer", "admin"],
};

export function hasRole(held: readonly string[], required: Role): boolean {
  return held.some((r) => isRole(r) && IMPLIES[r].includes(required));
}

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  roles: Role[];
  /** True when auth is disabled and this is the synthetic local user. */
  synthetic?: boolean;
};

/** Convenience flags, so components read `user.isDeveloper` rather than re-deriving it. */
export function roleFlags(user: SessionUser | null) {
  const roles = user?.roles ?? [];
  return {
    isViewer: hasRole(roles, "viewer"),
    isDeveloper: hasRole(roles, "developer"),
    isAdmin: hasRole(roles, "admin"),
  };
}
