import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { adminAtual } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
async function table() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS admin_theme_preferences (admin_id integer PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE, preferred_theme text NOT NULL DEFAULT 'original' CHECK (preferred_theme IN ('original','truck_dashboard')), updated_at timestamptz NOT NULL DEFAULT now())`);
}
export async function GET() {
  const admin = await adminAtual();
  if (!admin) return NextResponse.json({ erro: "Acesso restrito." }, { status: 401 });
  await table();
  const result = await db.execute(sql`SELECT preferred_theme FROM admin_theme_preferences WHERE admin_id = ${admin.id}`);
  const rows = (result as unknown as { rows?: { preferred_theme: string }[] }).rows ?? [];
  return NextResponse.json({ theme: rows[0]?.preferred_theme ?? "original" }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  const admin = await adminAtual();
  if (!admin) return NextResponse.json({ erro: "Acesso restrito." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["original", "truck_dashboard"].includes(body.theme)) return NextResponse.json({ erro: "Tema inválido." }, { status: 400 });
  await table();
  await db.execute(sql`INSERT INTO admin_theme_preferences (admin_id, preferred_theme) VALUES (${admin.id}, ${body.theme}) ON CONFLICT (admin_id) DO UPDATE SET preferred_theme = EXCLUDED.preferred_theme, updated_at = now()`);
  return NextResponse.json({ ok: true, theme: body.theme });
}
