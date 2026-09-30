import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { adminSessoes, admins } from "@/db/schema";
import { COOKIE_ADMIN, auditar, conferirSenha, exigirAdmin, hashSenha, ipDe } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

/** Troca a senha do administrador logado (pede a senha atual). */
export async function POST(req: Request) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const corpo = await req.json().catch(() => ({}));
  const atual = String(corpo.atual ?? "");
  const nova = String(corpo.nova ?? "");
  if (nova.length < 8) {
    return NextResponse.json({ erro: "A nova senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }
  const [a] = await db.select().from(admins).where(eq(admins.id, g.id)).limit(1);
  if (!a || !(await conferirSenha(atual, a.senhaHash))) {
    await auditar({ admin: g, integracao: "acesso", acao: "troca de senha recusada", ip: ipDe(req) });
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 403 });
  }
  await db.update(admins).set({ senhaHash: await hashSenha(nova) }).where(eq(admins.id, g.id));
  // Derruba as outras sessões abertas com a senha antiga; mantém esta.
  const token =
    (await cookies()).get(COOKIE_ADMIN)?.value ??
    ((await headers()).get("authorization") ?? "").replace(/^Bearer\s+/, "");
  const hashAtual = createHash("sha256").update(token).digest("hex");
  await db
    .delete(adminSessoes)
    .where(and(eq(adminSessoes.adminId, g.id), ne(adminSessoes.tokenHash, hashAtual)));
  await auditar({ admin: g, integracao: "acesso", acao: "trocou a senha", ip: ipDe(req) });
  return NextResponse.json({ ok: true });
}
