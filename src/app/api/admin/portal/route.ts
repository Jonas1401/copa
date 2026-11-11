import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { garantirTabelasPortal, painelPortalAdmin, removerAcessoPortal } from "@/lib/portal-copadubo";
import { monitorarMotorista, resumoDoMonitor } from "@/lib/portal-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CAB = { "Cache-Control": "no-store" };

/**
 * Portal do motorista — visão do ADMINISTRADOR (`/admin`).
 *
 * Só metadados: nome, CPF mascarado, 4 últimos caracteres da senha, o resumo
 * da última leitura e o diagnóstico. O CPF completo e a senha NUNCA saem do
 * servidor — nem para quem está logado no painel.
 *
 * GET  → { total, ativos, lidos24h, falhas, motoristas[], monitor }
 * POST → { motoristaId, acao: "ler" | "remover" }: lê o portal agora ou apaga
 *        o acesso daquele motorista (a senha dele sai do banco na hora).
 *
 * `monitor`: quem decide a saída do ponto (o Status do portal ou o quadro), o
 * intervalo da leitura e a situação guardada de cada ponto.
 */
async function painel() {
  return { ...(await painelPortalAdmin()), monitor: await resumoDoMonitor() };
}

export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirTabelasPortal();
  return NextResponse.json(await painel(), { headers: CAB });
}

export async function POST(req: Request) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirTabelasPortal();
  const corpo = await req.json().catch(() => ({}));
  const motoristaId = Number(corpo?.motoristaId);
  const acao = String(corpo?.acao ?? "");
  if (!Number.isSafeInteger(motoristaId) || motoristaId <= 0) {
    return NextResponse.json({ erro: "Motorista inválido." }, { status: 400, headers: CAB });
  }

  if (acao === "remover") {
    const removido = await removerAcessoPortal(motoristaId);
    await auditar({
      admin: g,
      integracao: "acesso",
      acao: "portal.remover",
      detalhe: `Acesso ao portal do motorista #${motoristaId} removido: ${removido ? "sim" : "já não existia"}.`,
      ip: ipDe(req),
    });
    return NextResponse.json({ removido, ...(await painel()) }, { headers: CAB });
  }

  if (acao !== "ler") {
    return NextResponse.json({ erro: "Ação inválida." }, { status: 400, headers: CAB });
  }

  // Leitura sob demanda: usa a sessão guardada do motorista (o login só se
  // repete se o portal pedir) e avisa a troca de situação como qualquer leitura.
  const r = await monitorarMotorista(motoristaId, { avisar: false }).catch((e: unknown) => ({
    rodou: false as const,
    motivo: e instanceof Error ? e.message.slice(0, 160) : "falha",
  }));
  const leu = "ok" in r && r.rodou ? Boolean(r.ok) : false;
  await auditar({
    admin: g,
    integracao: "acesso",
    acao: "portal.ler",
    detalhe: `Leitura do portal pedida pelo administrador (motorista #${motoristaId}): ${
      "ok" in r ? (leu ? "ok" : "sem conteúdo") : "não rodou"
    }.`,
    ip: ipDe(req),
  });
  return NextResponse.json({ resultado: r, ...(await painel()) }, { headers: CAB });
}
