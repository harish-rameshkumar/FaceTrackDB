import { Pool, types, type PoolClient } from "pg";

// Return TIMESTAMP and DATE columns as the raw strings Postgres sends. The
// default parser builds JS Dates in the server's own zone, which would shift
// the Asia/Kolkata wall-clock times the database stores.
types.setTypeParser(1114, (v: string) => v);
types.setTypeParser(1082, (v: string) => v);

// One shared pool for the whole server process. Cached on globalThis so
// Next.js hot reloading in development does not open a new pool per edit.
const globalForPool = globalThis as unknown as { __ftPool?: Pool };

function createPool(): Pool {
  // The web app should connect as the non-superuser login role ft_app (APP_DATABASE_URL, see
  // db/migrations/004_rbac.sql and the README). DATABASE_URL (the owner) is what the migrations, the demo
  // scripts and the tests use; the app falls back to it only so an old setup keeps working.
  const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  return new Pool({
    connectionString,
    max: 10,
    // The hostel runs on Indian time; never rely on the server's own zone.
    options: "-c timezone=Asia/Kolkata",
  });
}

export function getPool(): Pool {
  globalForPool.__ftPool ??= createPool();
  return globalForPool.__ftPool;
}

// ---- database roles for one request -------------------------------------------------------------
// The application role of the signed-in user and the matching PostgreSQL role (db/migrations/004_rbac.sql).
const DB_ROLES = {
  student: "ft_student",
  parent: "ft_parent",
  warden: "ft_warden",
  security: "ft_security",
  admin: "ft_admin",
} as const;
export type DbRoleName = keyof typeof DB_ROLES;

/**
 * Runs `fn` inside ONE transaction as the database role of the signed-in user: SET LOCAL ROLE ft_<role> and
 * set_config('app.user_id', ...) (read by the row-level-security policies), so PostgreSQL itself refuses what the
 * role may not do (GRANTs) and hides rows the user may not see (a student sees only their own, a parent only their
 * children's). Both settings end with the transaction, so a pooled connection never keeps a role.
 * Use it for every query of a route; the callback gets the client (queries, CALLs, savepoints).
 */
export async function withRole<T>(user: { userId: number; role: DbRoleName }, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const roleName = DB_ROLES[user.role];
  if (!roleName || !Number.isInteger(user.userId)) throw new Error("withRole needs a signed-in user");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(user.userId)]);
    await client.query(`SET LOCAL ROLE ${roleName}`); // roleName comes from the fixed map above, never from the request
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
