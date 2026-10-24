import "server-only";
import { Pool } from "pg";

// One shared connection pool for the whole app.
// In development Next.js reloads modules often, so the pool is kept on
// globalThis; otherwise every reload would open a fresh set of connections.
const globalForPg = globalThis as unknown as { facetrackPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.facetrackPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env to app/.env.local and restart the dev server."
      );
    }
    globalForPg.facetrackPool = new Pool({ connectionString, max: 10 });
  }
  return globalForPg.facetrackPool;
}
