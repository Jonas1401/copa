import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { motoristas, motoristaSessoes, subscriptions } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, iniciarSessaoMotorista, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import { paraMotorista } from "@/lib/motoristas";

export const dynamic = "force-dynamic";
const cab = { "Cache-Control": "no-store" };

/** Consulta a identidade deste aparelho, sem aceitar ID fornecido pelo cliente. */
export async function GET() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  return m ? NextResponse.json(paraMotorista(m), { headers: cab }) : naoAutorizadoMotorista();
}

/**
 * Migração dos aparelhos que já guardavam o perfil em localStorage antes da
 * sessão existir. Só um aparelho pode reivindicar o perfil antigo sem sessão;
 * outros aparelhos previamente inscritos em Web Push provam sua identidade
 * pela assinatura já registrada no banco.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof body?.criadoEm !== "string") {
    return naoAutorizadoMotorista();
  }
  const atual = await motoristaDaSessao();
  if (atual) {
    return atual.id === id
      ? NextResponse.json(paraMotorista(atual), { headers: cab })
      : naoAutorizadoMotorista();
  }
  const [m] = await db.select().from(motoristas).where(eq(motoristas.id, id)).limit(1);
  if (!m || m.criadoEm.toISOString() !== body.criadoEm) return naoAutorizadoMotorista();

  const [ativa] = await db
    .select({ id: motoristaSessoes.id })
    .from(motoristaSessoes)
    .where(and(eq(motoristaSessoes.motoristaId, id), gt(motoristaSessoes.expiraEm, new Date())))
    .limit(1);
  if (ativa) {
    const sub = body.subscription;
    const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
    const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
    const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
    const [aparelho] = endpoint && p256dh && auth
      ? await db.select({ id: subscriptions.id }).from(subscriptions).where(and(
          eq(subscriptions.motoristaId, id),
          eq(subscriptions.endpoint, endpoint),
          eq(subscriptions.p256dh, p256dh),
          eq(subscriptions.auth, auth),
        )).limit(1)
      : [];
    if (!aparelho) {
      return NextResponse.json(
        { erro: "Esse perfil já está vinculado a outro aparelho. Use o aparelho original para continuar." },
        { status: 403, headers: cab },
      );
    }
  }
  return iniciarSessaoMotorista(id, NextResponse.json(paraMotorista(m), { headers: cab }));
}
