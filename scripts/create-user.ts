/**
 * Create or update an application account.
 *
 *   npm run create-user -- --email you@example.com --role admin
 *   npm run create-user -- --email you@example.com --role admin --reset
 *
 * There is deliberately no public signup route: this is a private team tool, so
 * accounts are created by an operator.
 */
import "dotenv/config";
import { hashPassword, validatePassword } from "../lib/auth/password";
import { isRole, ROLES, type Role } from "../lib/auth/roles";
import { createUser, findUserByEmail, setPassword, setRoles } from "../lib/db/repositories/users";
import { promptHidden } from "./prompt";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Collect every --role occurrence, so several roles can be granted at once. */
function roleArgs(): string[] {
  return process.argv.reduce<string[]>((acc, value, i) => {
    if (value === "--role" && process.argv[i + 1]) acc.push(process.argv[i + 1]);
    return acc;
  }, []);
}

function usage(): never {
  console.error("Usage: npm run create-user -- --email you@example.com [--name Name] [--role admin] [--reset]");
  console.error(`Roles: ${ROLES.join(", ")}. Repeat --role to grant several.`);
  process.exit(1);
}

async function main() {
  const email = arg("email");
  if (!email) usage();

  const requested = roleArgs();
  const roles: Role[] = requested.filter(isRole);
  if (requested.length !== roles.length) {
    console.error(`Unknown role. Valid roles: ${ROLES.join(", ")}`);
    process.exit(1);
  }
  if (!roles.length) roles.push("viewer");

  const existing = await findUserByEmail(email);
  if (existing && !flag("reset")) {
    console.error(`${email} already exists. Pass --reset to set a new password and roles.`);
    process.exit(1);
  }

  const password = await promptHidden("Password: ");
  const problem = validatePassword(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (password !== (await promptHidden("Confirm password: "))) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    await setPassword(email, passwordHash);
    await setRoles(email, roles);
    console.log(`Updated ${email} with roles: ${roles.join(", ")}`);
  } else {
    await createUser({ email, name: arg("name") ?? "", passwordHash, roles });
    console.log(`Created ${email} with roles: ${roles.join(", ")}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
