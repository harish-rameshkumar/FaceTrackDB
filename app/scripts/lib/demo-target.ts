// Safety for the demo commands: say which database they would touch, and refuse to go further
// without --yes. The same words are printed by demo:seed, demo:reset and demo:history.
export interface Target { host: string; port: string; database: string; user: string; local: boolean }

export function describeTarget(url = process.env.DATABASE_URL): Target {
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const u = new URL(url);
  return {
    host: u.hostname, port: u.port || "5432", database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username),
    local: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname),
  };
}

/**
 * Prints the target and exits unless --yes was given. Extra guards:
 *   --db NAME      refuses unless the database really is called NAME (type the name you expect);
 *   a database on another machine is refused unless --allow-remote is given.
 */
export function confirmTarget(args: string[], what: string): Target {
  const t = describeTarget();
  console.log(`${what}\n  target database: ${t.database}  (host ${t.host}:${t.port}, user ${t.user})`);
  const dbFlag = args.indexOf("--db");
  if (dbFlag >= 0 && args[dbFlag + 1] !== t.database) {
    console.error(`REFUSING: --db ${args[dbFlag + 1] ?? "(missing)"} does not match the database in DATABASE_URL (${t.database}).`);
    process.exit(1);
  }
  if (!t.local && !args.includes("--allow-remote")) {
    console.error(`REFUSING: ${t.host} is not this machine. Add --allow-remote if you really mean it.`);
    process.exit(1);
  }
  if (!args.includes("--yes")) {
    console.log("Nothing was changed. Check the database above, then run again with --yes.");
    process.exit(1);
  }
  return t;
}

export const argValue = (args: string[], flag: string): string | null => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
