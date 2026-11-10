import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";
import {
  decidirAvisoDeSaida,
  gravarModoSaida,
  lerModoSaida,
  montarEventoSaida,
  ultimosEventosSaida,
  verificarSaidaDoMotorista,
  MAX_CONSULTAS_ATIVO,
  type ModoSaida,
} from "@/lib/portal-saida";
import { interpretarAtivos, interpretarStatus, type SecaoPortal } from "@/lib/portal-copadubo-parse";
import { textoAvisoSaida } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CAB = { "Cache-Control": "no-store" };

/**
 * SAÍDA DO PONTO (teste do administrador) — `/admin → Portal do motorista`.
 *
 * O que faz: quando o ponto monitorado sai do quadro (status SAIU na fila), o
 * app entra no portal com o CPF/senha do próprio motorista, lê o **Status do
 * Ponto** (ATIVO, ESCALADO com os dados da escala, ou EM DISPENSA com o
 * motivo) e a **Tela de Ativos** (fila do livro) e monta o aviso que o
 * motorista recebe. A consulta automática não depende desta rota: aqui ficam
 * só o teste manual e a simulação.
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
    const cenario = String(corpo?.cenario ?? "escalado");
    const codigo = String(corpo?.codigo ?? "A032").toUpperCase();
    const { secoes, exemplo, cod, letra, ehUltimoEscalado } = telasDeExemplo(cenario, codigo);
    const status = interpretarStatus(secoes, cod);
    const evento = montarEventoSaida(status, interpretarAtivos(secoes), cod, { nomeMotorista: "Motorista de Exemplo" });
    // A mesma decisão e o mesmo texto do envio de verdade (nada é enviado).
    const decisao = decidirAvisoDeSaida({
      codigo: cod,
      situacao: { tipo: "status", evento },
      ehUltimoEscalado,
      tentativas: MAX_CONSULTAS_ATIVO,
      idadeMs: 0,
    });
    const texto =
      decisao.acao === "avisar"
        ? textoAvisoSaida({ codigo: cod, rotulo: "Truck", livro: letra, saidaPorUltimo: ehUltimoEscalado, portal: decisao.portal })
        : null;
    return NextResponse.json(
      {
        simulado: true,
        exemplo,
        evento,
        aviso: texto ? { titulo: texto.title, mensagem: texto.body } : null,
        decisao: decisao.motivo,
        modo: (await lerModoSaida()).modo,
      },
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
 * Telas de exemplo para a SIMULAÇÃO no painel (nada de rede, nada de dado
 * real). O cartão segue o que o portal mostrou nos prints de 09/11/2026:
 * código, placa e a situação; nome e placa aqui são inventados.
 *
 * As linhas da escala do cenário ESCALADO também são INVENTADAS: o app não
 * supõe o nome dos campos — no aviso de verdade vão as linhas que o portal
 * escrever no cartão do ponto.
 *
 * Cenários: `escalado`, `dispensa`, `ativo` (o número virou Último Escalado no
 * quadro, mas o portal ainda diz ATIVO), `ativo_fora` (o número sumiu do
 * quadro e o portal continua ATIVO) e `atendimento` (versão antiga da tela).
 */
function telasDeExemplo(
  cenario: string,
  codigo: string,
): { secoes: SecaoPortal[]; exemplo: string; cod: string; letra: string; ehUltimoEscalado: boolean } {
  const ponto = codigo.replace(/\D/g, "").padStart(3, "0");
  const letra = /^[ABM]/.test(codigo) ? codigo[0] : "A";
  const cod = `${letra}${ponto}`;
  const proximo = `${letra}${String(Number(ponto) + 3).padStart(3, "0")}`;
  const cenarios: Record<string, { selo: string; linhas: string[]; exemplo: string; ultimo: boolean }> = {
    escalado: {
      selo: "ESCALADO",
      linhas: ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"],
      exemplo: "Status do Ponto: ESCALADO · as linhas da escala são inventadas (o aviso leva as que o portal escrever)",
      ultimo: true,
    },
    dispensa: {
      selo: "EM DISPENSA",
      linhas: ["Desde hoje, 11:32 · há 9 min", "MOTIVO", "001 - OFICINA"],
      exemplo: "Status do Ponto: EM DISPENSA · motivo 001 - OFICINA · há 9 min",
      ultimo: false,
    },
    ativo: {
      selo: "ATIVO",
      linhas: ["Desde hoje, 07:10"],
      exemplo: "Status do Ponto: ATIVO, mas o número virou o Último Escalado do quadro (o portal ainda não registrou a escala)",
      ultimo: true,
    },
    ativo_fora: {
      selo: "ATIVO",
      linhas: ["Desde hoje, 07:10"],
      exemplo: "Status do Ponto: ATIVO e o número só sumiu do quadro (depois das novas consultas, o portal continuou ATIVO)",
      ultimo: false,
    },
    atendimento: {
      selo: "EM ATENDIMENTO",
      linhas: ["Desde hoje, 11:32 · há 9 min"],
      exemplo: "Status do Ponto: EM ATENDIMENTO · Tela de Ativos: Livro A - Truck",
      ultimo: true,
    },
  };
  const c = cenarios[cenario] ?? cenarios.escalado;

  const secoes: SecaoPortal[] = [
    {
      titulo: "Status do Ponto",
      linhas: [`${cod} · ABC-1D23 · ${c.selo}`, ...c.linhas, "MOTORISTA DE EXEMPLO"],
    },
    {
      titulo: `Livro ${letra} - Truck`,
      linhas: [
        "Último Ponto Escalado",
        c.ultimo ? cod : `${letra}102`,
        "SEQ · PONTO · TIPO",
        `1 · ${proximo} · TRUCK 4 EIXOS`,
        `2 · ${letra}115 · TRUCK 4 EIXOS`,
        `3 · ${letra}122 · TRUCK BA 2E`,
      ],
    },
  ];
  return { secoes, exemplo: c.exemplo, cod, letra, ehUltimoEscalado: c.ultimo };
}
