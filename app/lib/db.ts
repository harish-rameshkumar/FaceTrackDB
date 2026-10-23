import { Pool, types } from "pg";

// Return TIMESTAMP and DATE columns as the raw strings Postgres sends. The
// default parser builds JS Dates in the server's own zone, which would shift
// the Asia/Kolkata wall-clock times the database stores.
types.setTypeParser(1114, (v: string) => v);
types.setTypeParser(1082, (v: string) => v);

// One shared pool for the whole server process. Cached on globalThis so
// Next.js hot reloading in development does not open a new pool per edit.
const globalForPool = globalThis as unknown as { __ftPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
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
