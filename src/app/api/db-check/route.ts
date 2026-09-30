import { pool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await pool.query("select 1 as ok");
    return Response.json({ ok: true, db: r.rows[0] });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        erro: e instanceof Error ? e.message : String(e),
        tem: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
          POSTGRES_PRISMA_URL: Boolean(process.env.POSTGRES_PRISMA_URL),
        },
      },
      { status: 500 },
    );
  }
}
