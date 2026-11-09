import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";
import {
  gravarModoSaida,
  lerModoSaida,
  montarEventoSaida,
  ultimosEventosSaida,
  verificarSaidaDoMotorista,
  type ModoSaida,
} from "@/lib/portal-saida";
import { interpretarAtivos, interpretarStatus, type SecaoPortal } from "@/lib/portal-copadubo-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CAB = { "Cache-Control": "no-store" };

/**
 * SAÍDA DO PONTO (teste do administrador) — `/admin → Portal do motorista`.
 *
 * O que faz: quando o ponto monitorado sai (status SAIU na fila, ou o portal
 * mostra EM ATENDIMENTO / EM DISPENSA), o app entra no portal com o CPF/senha
 * do próprio motorista, lê a **Tela de Ativos** (fila do livro, tipo de
 * trabalho) e o **Status do Ponto** (turno, motivo da dispensa) e monta o
 * aviso que o motorista receberia.
 *
 * GET  → { modo, caminhos, eventos[] } (modo + últimos avisos registrados)
 * POST → { acao }
 *   - "modo"        { modo, caminhos }: liga/desliga e em que nível
 *                   (desligado | somente_admin | motoristas)
 *   - "teste"       { motoristaId }: lê o portal de verdade e mostra o aviso
 *   - "simular"     { motoristaId?, codigo?, cenario }: monta o aviso com uma
 *                   tela de exemplo (sem tocar no portal nem no celular)
 *   - "enviar"      { motoristaId }: checagem real; envia Push só no modo
 *                   "motoristas" (no "somente_admin" fica só no registro)
 * Todas as ações passam pela auditoria.
 */
export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirTabelasPortal();
  const { modo, caminhos } = await lerModoSaida();
  return NextResponse.json({ modo, caminhos, eventos: await ultimosEventosSaida(12) }, { headers: CAB });
}

export async function POST(req: Request) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirTabelasPortal();
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao ?? "");

  if (acao === "modo") {
    const modo = String(corpo?.modo ?? "desligado") as ModoSaida;
    if (!["desligado", "somente_admin", "motoristas"].includes(modo)) {
      return NextResponse.json({ erro: "Modo inválido." }, { status: 400, headers: CAB });
    }
    const caminhos = Array.isArray(corpo?.caminhos) ? corpo.caminhos.map((c: unknown) => String(c)) : undefined;
    const atual = await lerModoSaida();
    await gravarModoSaida(modo, caminhos ?? atual.caminhos);
    await auditar({
      admin: g,
      integracao: "acesso",
      acao: "portal.modo_saida",
      detalhe: `Modo da saída do ponto: ${modo} · telas: ${(caminhos ?? atual.caminhos).join(" / ") || "início"}.`,
      ip: ipDe(req),
    });
    return NextResponse.json(
      { modo: (await lerModoSaida()).modo, caminhos: (await lerModoSaida()).caminhos, eventos: await ultimosEventosSaida(12) },
      { headers: CAB },
    );
  }

  if (acao === "simular") {
    const cenario = String(corpo?.cenario ?? "atendimento");
    const codigo = String(corpo?.codigo ?? "A032").toUpperCase();
    const { secoes, exemplo } = telasDeExemplo(cenario, codigo);
    const status = interpretarStatus(secoes);
    const evento = montarEventoSaida(status, interpretarAtivos(secoes), codigo);
    return NextResponse.json(
      { simulado: true, exemplo, evento, modo: (await lerModoSaida()).modo },
      { headers: CAB },
    );
  }

  const motoristaId = Number(corpo?.motoristaId);
  if (!Number.isSafeInteger(motoristaId) || motoristaId <= 0) {
    return NextResponse.json({ erro: "Escolha o motorista (ele precisa ter CPF/senha cadastrados)." }, { status: 400, headers: CAB });
  }

  if (acao === "teste" || acao === "enviar") {
    const r = await verificarSaidaDoMotorista(motoristaId, { origem: "admin" });
    await auditar({
      admin: g,
      integracao: "acesso",
      acao: acao === "teste" ? "portal.teste_saida" : "portal.enviar_saida",
      detalhe: `Saída do ponto (motorista #${motoristaId}): ${
        r.rodou
          ? r.evento
            ? `${r.evento.dispensa ? "dispensa" : r.evento.saiu ? "saida" : "movimento"} · ${r.evento.codigo ?? "—"} · destino ${r.destino}`
            : `não rodou (${r.motivo})`
          : "não rodou"
      }.`,
      ip: ipDe(req),
    });
    return NextResponse.json(
      { resultado: r, modo: (await lerModoSaida()).modo, eventos: await ultimosEventosSaida(12) },
      { headers: CAB },
    );
  }

  return NextResponse.json({ erro: "Ação inválida." }, { status: 400, headers: CAB });
}

/**
 * Telas de exemplo para a SIMULAÇÃO no painel (nada de rede). São montadas a
 * partir do texto que o portal mostra nos prints de 09/11/2026.
 */
function telasDeExemplo(cenario: string, codigo: string): { secoes: SecaoPortal[]; exemplo: string } {
  const ponto = codigo.replace(/\D/g, "").padStart(3, "0");
  const letra = /^[ABM]/.test(codigo) ? codigo[0] : "A";
  const cod = `${letra}${ponto}`;
  const proximo = `${letra}${String(Number(ponto) + 3).padStart(3, "0")}`;
  const turno =
    cenario === "dispensa"
      ? { selo: "EM DISPENSA", motivo: "MOTIVO", detalhe: "001 - OFICINA" }
      : cenario === "atendimento"
        ? { selo: "EM ATENDIMENTO", motivo: "", detalhe: "" }
        : { selo: "AGUARDANDO", motivo: "", detalhe: "" };

  const secoes: SecaoPortal[] = [
    {
      titulo: "Status do Ponto",
      linhas: [
        `${cod} · ADG-1J42 · ${turno.selo}`,
        "Desde hoje, 11:32 · há 9 min",
        ...(turno.motivo ? [turno.motivo, turno.detalhe] : []),
        "JONAS PAULO DE SOUZA",
      ],
    },
    {
      titulo: `Livro ${letra} - Truck`,
      linhas: [
        "Último Ponto Escalado",
        `${letra}102`,
        "SEQ · PONTO · TIPO",
        `1 · ${proximo} · TRUCK 4 EIXOS`,
        `2 · ${letra}115 · TRUCK 4 EIXOS`,
        `3 · ${letra}122 · TRUCK BA 2E`,
      ],
    },
  ];
  const exemplo =
    cenario === "dispensa"
      ? "Status do Ponto: EM DISPENSA · motivo 001 - OFICINA · há 9 min"
      : cenario === "atendimento"
        ? "Status do Ponto: EM ATENDIMENTO · Tela de Ativos: Livro A - Truck"
        : "Status do Ponto: AGUARDANDO (não saiu)";
  return { secoes, exemplo };
}
