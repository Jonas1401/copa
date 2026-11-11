import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";
import {
  MAX_PONTOS_POR_LEITURA,
  atualizarTicketsDoMotorista,
  codigosDoMotorista,
  desligarTicket,
  porcentagensDoPedido,
  resumoDoTicket,
  salvarPorcentagensDoTicket,
  ticketLigado,
  type LeituraDoTicket,
  type ResumoDoTicket,
} from "@/lib/portal-ticket";
import { CABECALHO_DA_TELA, listaDePontos, resumoParaATela } from "@/lib/ticket-card";

/**
 * SALDO DE GANHOS — as viagens da semana (aba “Ticket” do Portal do
 * Motorista) e a comissão, só do PRÓPRIO motorista.
 *
 *   GET    → o que está guardado (não fala com o portal);
 *   POST   → { porcentagens: { A032: "18", A063: "20,5" } } cadastra a
 *            porcentagem de cada ponto (a primeira é o que liga a consulta) e
 *            tenta a primeira leitura. Cada ponto tem a sua; o saldo soma todos;
 *   PUT    → “Atualizar”: lê agora, sem esperar o ciclo de 5 minutos;
 *   DELETE → desliga a consulta: as porcentagens e as viagens saem do banco.
 *
 * Nenhuma destas chamadas faz login no portal: a leitura usa a sessão que a
 * olhada do Status (de 1 em 1 minuto) deixa aberta.
 */

export const dynamic = "force-dynamic";
/** Uma leitura tem de 12 a 20 s de prazo (a tela do formulário e um “Gerar” por ponto do app); o padrão de 10 s é curto. */
export const maxDuration = 30;
/** A leitura feita dentro de um pedido tem de acabar até aqui (contado do começo do pedido), com folga para os 30 s. */
const LEITURA_TERMINA_ATE_MS = 24_000;
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
      : `Li no portal: ${leitura.lidos.join(", ")}. Os outros pontos entram nas próximas leituras (até ${MAX_PONTOS_POR_LEITURA} por vez).`;
  }
  if (falhas.some(([, motivo]) => /pediu o login de novo|sem sessão aberta/.test(motivo))) {
    return "A sessão do portal fechou. Ela é reaberta sozinha na próxima olhada do Status (até 1 minuto) e as viagens vêm em seguida.";
  }
  if (leitura.lidos.length) return `Li ${leitura.lidos.join(", ")}. Não veio: ${falhas.map(([codigo, motivo]) => `${codigo} (${motivo})`).join("; ")}.`;
  return `O portal não mostrou as viagens: ${falhas[0]?.[1] ?? "a tela não veio como esperado"}.`;
}

/** O resumo como a tela que pediu sabe mostrar (uma tela aberta antes da porcentagem por ponto não manda o cabeçalho). */
const paraATela = (req: Request, resumo: ResumoDoTicket) => resumoParaATela(resumo, req.headers.get(CABECALHO_DA_TELA));

export async function GET(req: Request) {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  return NextResponse.json(paraATela(req, await resumoDoTicket(m.id)), { headers: CAB });
}

export async function POST(req: Request) {
  const inicio = Date.now();
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();

  // A porcentagem é de cada ponto, e só dos pontos que ESTE motorista tem no app.
  const codigos = await codigosDoMotorista(m.id);
  const pedido = porcentagensDoPedido(await req.json().catch(() => ({})), codigos);
  if ("erro" in pedido) return NextResponse.json({ erro: pedido.erro }, { status: 400, headers: CAB });
  await salvarPorcentagensDoTicket(m.id, pedido.porPonto);

  // Primeira leitura já, com a sessão guardada — se der. A porcentagem fica salva de qualquer jeito.
  let leitura: LeituraDoTicket | null = null;
  let resumo = await resumoDoTicket(m.id);
  const jaTemViagens = resumo.pontos.some((p) => p.viagens);
  if (ticketLigado() && resumo.temAcesso && resumo.totalPontos && !resumo.completo) {
    try {
      leitura = await atualizarTicketsDoMotorista(m.id, { forcar: true, terminarAte: inicio + LEITURA_TERMINA_ATE_MS });
      resumo = await resumoDoTicket(m.id);
    } catch (e) {
      console.error("[tickets] primeira leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  const salvos = Object.keys(pedido.porPonto);
  const salvo = codigos.length === 1 ? "Porcentagem salva." : salvos.length === 1 ? `Porcentagem do ${salvos[0]} salva.` : "Porcentagens salvas.";
  // Com mais de um ponto, o motorista salva um de cada vez: diz qual ainda falta.
  const falta = resumo.semPorcentagem.length ? ` Falta a ${listaDePontos(resumo.semPorcentagem)}.` : "";
  // Sem novidade do portal para contar (já estava lido, ou a leitura acabou de ser feita): só o “salvo”.
  const semNovidade = resumo.completo || (jaTemViagens && !leitura?.tentou) || leitura?.motivo === "nao_e_a_hora";
  const mensagem = semNovidade ? `${salvo}${falta}` : `${salvo}${falta} ${mensagemDaLeitura(leitura, resumo)}`;
  return NextResponse.json({ salvo: true, ...paraATela(req, resumo), mensagem }, { headers: CAB });
}

export async function PUT(req: Request) {
  const inicio = Date.now();
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
      leitura = await atualizarTicketsDoMotorista(m.id, { forcar: true, terminarAte: inicio + LEITURA_TERMINA_ATE_MS });
    } catch (e) {
      console.error("[tickets] leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  const resumo = await resumoDoTicket(m.id);
  return NextResponse.json({ ...paraATela(req, resumo), leu: Boolean(leitura?.lidos.length), mensagem: mensagemDaLeitura(leitura, resumo) }, { headers: CAB });
}

export async function DELETE() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const desligado = await desligarTicket(m.id);
  return NextResponse.json({ desligado, ...(await resumoDoTicket(m.id)) }, { headers: CAB });
}
