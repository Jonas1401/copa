import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { amostras, motoristas, pontos, subscriptions } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirTabelas, paraDTO, type PontoDTO } from "@/lib/estado";
import { ultimosAlertas } from "@/lib/alerta-admin";

export const dynamic = "force-dynamic";

export type MotoristaAdmin = {
  id: number;
  nome: string;
  criadoEm: string;
  /** Aparelhos com notificação ativa (recebem os avisos do ponto). */
  avisos: number;
  pontos: PontoDTO[];
  /** Último alerta individual enviado pelo administrador (null = nenhum). */
  alerta: { criadoEm: string; resolvidoEm: string | null } | null;
};

/**
 * GET /api/admin/motoristas → todos os motoristas com nome e pontos.
 * SÓ ADMINISTRADOR: os motoristas veem apenas os próprios pontos no app.
 */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();

  const [lista, todos, avisos, ultimas] = await Promise.all([
    db.select({ id: motoristas.id, nome: motoristas.nome, criadoEm: motoristas.criadoEm }).from(motoristas),
    db.select().from(pontos).orderBy(pontos.ordem, pontos.id),
    db
      .select({ motoristaId: subscriptions.motoristaId, n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.ativa, 1))
      .groupBy(subscriptions.motoristaId),
    db.select({ em: amostras.criadoEm }).from(amostras).orderBy(desc(amostras.id)).limit(1),
  ]);

  const ids = new Set(lista.map((m) => m.id));
  const porMotorista = new Map<number, PontoDTO[]>();
  const semDono: PontoDTO[] = [];
  for (const p of todos) {
    const dto = paraDTO(p);
    // Ponto antigo sem dono (ou de um cadastro apagado): aparece à parte.
    if (p.motoristaId == null || !ids.has(p.motoristaId)) semDono.push(dto);
    else porMotorista.set(p.motoristaId, [...(porMotorista.get(p.motoristaId) ?? []), dto]);
  }
  const alertas = await ultimosAlertas(lista.map((m) => m.id)).catch(() => new Map());
  const aparelhos = new Map<number, number>();
  for (const a of avisos) if (a.motoristaId != null) aparelhos.set(a.motoristaId, a.n);

  const saida: MotoristaAdmin[] = lista
    .map((m) => ({
      id: m.id,
      nome: m.nome,
      criadoEm: m.criadoEm.toISOString(),
      avisos: aparelhos.get(m.id) ?? 0,
      pontos: porMotorista.get(m.id) ?? [],
      alerta: alertas.get(m.id) ?? null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) || a.id - b.id);

  return NextResponse.json(
    { motoristas: saida, semDono, ultimaLeitura: ultimas[0]?.em?.toISOString() ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
