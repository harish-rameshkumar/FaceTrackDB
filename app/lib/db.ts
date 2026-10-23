import { Pool } from "pg";

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
