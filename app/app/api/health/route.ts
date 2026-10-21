import { Pool } from "pg";
import { QdrantClient } from "@qdrant/js-client-rest";


export async function GET() {
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("select 1");
    await pool.end();
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL });
    await qdrant.getCollections();
    return Response.json({ postgres: "connected", qdrant: "connected" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
