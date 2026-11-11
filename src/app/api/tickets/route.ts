import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";
import {
  atualizarTicketsDoMotorista,
  desligarTicket,
  porcentagemEmCentesimos,
  resumoDoTicket,
  salvarPorcentagemDoTicket,
  ticketLigado,
  type LeituraDoTicket,
  type ResumoDoTicket,
} from "@/lib/portal-ticket";

/**
 * CONSULTA DE PONTO — as viagens da semana (aba “Ticket” do Portal do
 * Motorista) e a comissão, só do PRÓPRIO motorista.
 *
 *   GET    → o que está guardado (não fala com o portal);
 *   POST   → { porcentagem } cadastra a porcentagem (é o que liga a consulta) e
 *            tenta a primeira leitura;
 *   PUT    → “Atualizar”: lê agora, sem esperar o ciclo de 5 minutos;
 *   DELETE → desliga a consulta: a porcentagem e as viagens saem do banco.
 *
 * Nenhuma destas chamadas faz login no portal: a leitura usa a sessão que a
 * olhada do Status (de 1 em 1 minuto) deixa aberta.
 */

export const dynamic = "force-dynamic";
/** Uma leitura tem 12 s de prazo no total (normalmente 2 a 7 pedidos ao portal); o padrão de 10 s é curto. */
export const maxDuration = 30;
const CAB = { "Cache-Control": "private, no-store" };

/** O que dizer ao motorista depois de uma tentativa de leitura (sem nenhum valor). */
function mensagemDaLeitura(leitura: LeituraDoTicket | null, resumo: ResumoDoTicket): string {
  if (!resumo.disponivel) return "A leitura do Ticket está desligada neste servidor.";
  if (!resumo.temAcesso) return "Para eu ler as suas viagens, cadastre o CPF e a senha do Portal do Motorista (card “Portal do Motorista”).";
  if (!resumo.totalPontos) return "Cadastre o seu ponto no app: é dele que eu leio as viagens.";
  if (!leitura) return "Não consegui ler agora. Tento de novo sozinho em alguns minutos.";
  if (!leitura.tentou) {
    return leitura.motivo === "nao_e_a_hora" ? "Acabei de consultar o portal. Espere uns segundos e toque de novo." : "Não consegui ler agora. Tento de novo sozinho em alguns minutos.";
  }
  const falhas = Object.entries(leitura.falhas);
  if (leitura.lidos.length && !falhas.length) {
    return resumo.completo
      ? `Pronto! Li no portal as viagens ${leitura.lidos.length === 1 ? `do ${leitura.lidos[0]}` : `de ${leitura.lidos.join(", ")}`}.`
      : `Li no portal: ${leitura.lidos.join(", ")}. Os outros pontos entram nas próximas leituras (até 3 por vez).`;
  }
  if (falhas.some(([, motivo]) => /pediu o login de novo|sem sessão aberta/.test(motivo))) {
    return "A sessão do portal fechou. Ela é reaberta sozinha na próxima olhada do Status (até 1 minuto) e as viagens vêm em seguida.";
  }
  if (leitura.lidos.length) return `Li ${leitura.lidos.join(", ")}. Não veio: ${falhas.map(([codigo, motivo]) => `${codigo} (${motivo})`).join("; ")}.`;
  return `O portal não mostrou as viagens: ${falhas[0]?.[1] ?? "a tela não veio como esperado"}.`;
}

export async function GET() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  return NextResponse.json(await resumoDoTicket(m.id), { headers: CAB });
}

export async function POST(req: Request) {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();

  const corpo = await req.json().catch(() => ({}));
  const centesimos = porcentagemEmCentesimos(corpo?.porcentagem);
  if (centesimos === null) {
    return NextResponse.json({ erro: "Digite a sua porcentagem (por exemplo 18 ou 18,5)." }, { status: 400, headers: CAB });
  }
  await salvarPorcentagemDoTicket(m.id, centesimos);

  // Primeira leitura já, com a sessão guardada — se der. A porcentagem fica salva de qualquer jeito.
  let leitura: LeituraDoTicket | null = null;
  let resumo = await resumoDoTicket(m.id);
  const jaTemViagens = resumo.pontos.some((p) => p.viagens);
  if (ticketLigado() && resumo.temAcesso && resumo.totalPontos && !resumo.completo) {
    try {
      leitura = await atualizarTicketsDoMotorista(m.id, { forcar: true });
      resumo = await resumoDoTicket(m.id);
    } catch (e) {
      console.error("[tickets] primeira leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  const mensagem =
    resumo.completo || (jaTemViagens && !leitura?.tentou)
      ? "Porcentagem salva."
      : `Porcentagem salva. ${mensagemDaLeitura(leitura, resumo)}`;
  return NextResponse.json({ salvo: true, ...resumo, mensagem }, { headers: CAB });
}

export async function PUT() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const antes = await resumoDoTicket(m.id);
  if (!antes.ligado) {
    return NextResponse.json({ erro: "Cadastre a sua porcentagem primeiro." }, { status: 404, headers: CAB });
  }
  let leitura: LeituraDoTicket | null = null;
  if (antes.disponivel && antes.temAcesso && antes.totalPontos) {
    try {
      leitura = await atualizarTicketsDoMotorista(m.id, { forcar: true });
    } catch (e) {
      console.error("[tickets] leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  const resumo = await resumoDoTicket(m.id);
  return NextResponse.json({ ...resumo, leu: Boolean(leitura?.lidos.length), mensagem: mensagemDaLeitura(leitura, resumo) }, { headers: CAB });
}

export async function DELETE() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const desligado = await desligarTicket(m.id);
  return NextResponse.json({ desligado, ...(await resumoDoTicket(m.id)) }, { headers: CAB });
}
