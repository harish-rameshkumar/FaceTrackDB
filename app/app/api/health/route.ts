import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { getQdrant } from "@/lib/qdrant";

export async function GET() {
  await connection();
  const result = { postgres: "down", qdrant: "down" };
  try {
    await getPool().query("select 1");
    result.postgres = "connected";
  } catch (e) {
    console.error("health: postgres check failed", e);
  }
  try {
    await getQdrant().getCollections();
    result.qdrant = "connected";
  } catch (e) {
    console.error("health: qdrant check failed", e);
  }
  const ok = result.postgres === "connected" && result.qdrant === "connected";
  return Response.json(result, { status: ok ? 200 : 503 });
}
