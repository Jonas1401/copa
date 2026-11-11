import { quantPlausivel, valorPlausivel } from "@/lib/frete";
import { atributos, decodificarEntidades, enderecoDeAcao, limparHtml, normalizarCodigoPortal } from "@/lib/portal-copadubo-parse";
import { linhasDaTela } from "@/lib/portal-fila-parse";

/**
 * ABA “TICKET” DO PORTAL DO MOTORISTA — a “2ª Via de Ticket”.
 *
 * É de onde sai a “Consulta de Ponto” do app (viagens, valor bruto e comissão
 * da semana). A tela, como o motorista vê:
 *
 *   2ª Via de Ticket
 *   Selecione o período
 *   PONTO   [ A701 ▾ ]              ← os pontos da conta (pode repetir código)
 *   SEMANA  [ 09/11/2026 - 16/11/2026 ▾ ]
 *   [ Gerar ]
 *
 * e, depois do “Gerar”:
 *
 *   Tickets
 *   Período   09/11/2026 - 16/11/2026
 *   [ Gerar PDF ]                   ← nunca é aberto
 *   Lançamentos
 *   PONTO  QUANT   VALOR  SERVIÇO         DATA        HORA
 *   A032   29.920  17.29  FRETE ATE 5 KM  14/09/2026  21:00
 *   …ou “Nenhum lançamento encontrado para este período.”
 *
 * Cada lançamento é uma viagem: Quant em toneladas, Valor em R$ por tonelada —
 * o mesmo ticket que a calculadora de frete lê por foto (`frete.ts`).
 *
 * Aqui só há interpretação de texto: nada de rede e nada de banco.
 *
 * O que sai daqui vira dinheiro na tela do motorista, então a leitura é
 * RÍGIDA: o formulário só vale com as duas listas (pontos e semanas) e nada
 * para digitar; a tela de lançamentos só vale inteira, com o cabeçalho das
 * seis colunas, e cada linha com ponto, quant, valor, data e hora que façam
 * sentido — do ponto pedido e dentro da semana pedida. Linha que a leitura não
 * entendeu nunca é pulada: a tela inteira é recusada, e quem chama fica com a
 * última leitura boa (e sabe o motivo).
 *
 * O HTML de verdade nunca foi visto (só a tela, em foto, e sem nenhum
 * lançamento). Por isso a tabela é aceita nas mesmas três formas da aba
 * “Fila”: células de tabela, tudo numa linha e uma célula por linha.
 */

/** O link do menu é o da aba “Ticket”. */
export const ehAbaDoTicket = (texto: string) => /^tickets?$/i.test(texto.trim());

/* ------------------------------------------------------------- formulário */

export type PontoDoTicket = {
  /** O que o formulário envia para este ponto. */
  valor: string;
  /** O código como o portal escreve (A032). */
  codigo: string;
};

export type SemanaDoTicket = {
  /** O que o formulário envia para esta semana. */
  valor: string;
  /** Primeiro e último dia da semana (aaaa-mm-dd). */
  inicio: string;
  fim: string;
  /** É a semana que o portal deixa marcada ao abrir a tela. */
  selecionada: boolean;
};

export type FormularioDeTicket = {
  action: string;
  method: "get" | "post";
  campoPonto: string;
  pontos: PontoDoTicket[];
  campoSemana: string;
  semanas: SemanaDoTicket[];
  /** Campos escondidos do formulário, enviados como estão. */
  ocultos: { nome: string; valor: string }[];
  /** Botão de envio com nome (alguns PHP exigem o nome dele no pedido). */
  botao: { nome: string; valor: string } | null;
};

/** A tela não trouxe o formulário esperado: o motivo e a ESTRUTURA do que veio (nunca valores). */
export type FormularioRecusado = { motivo: string; estrutura: string[] };

/** Opção cujo texto é um código de ponto (“A032”, “A032 - …”). */
const RE_OPCAO_PONTO = /^\s*(?:ponto\s*[:\-–]?\s*)?([ABM])\s?-?(\d{1,4})\b/i;
/** Opção cujo texto é uma semana (“09/11/2026 - 16/11/2026”, “… a …”, “… até …”). */
const RE_OPCAO_SEMANA = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*(?:-|–|—|a|à|at[ée])\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/i;
/** Um formulário que fala disto NÃO é a consulta do ticket: é uma ação. */
const RE_FORMULARIO_DE_ACAO = /dispensa|motivo|exclu|apag|remov|\bsair\b|senha|password/i;

/** aaaa-mm-dd de uma data dd/mm/aaaa que existe no calendário (ou null). */
export function dataDoPortal(dia: string, mes: string, ano: string): string | null {
  const [d, m, a] = [Number(dia), Number(mes), Number(ano)];
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(a) || a < 2020 || a > 2100) return null;
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** aaaa-mm-dd → dd/mm (para as mensagens). */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O dia de hoje no fuso do porto (America/Sao_Paulo), em aaaa-mm-dd. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${de("year")}-${de("month")}-${de("day")}`;
}

type ListaDaTela = { nome: string; opcoes: { valor: string; texto: string; selecionada: boolean }[] };

/** As listas (`<select>`) de um trecho de HTML, com as opções e qual está marcada. */
function listasDe(html: string): ListaDaTela[] {
  const listas: ListaDaTela[] = [];
  const reSelect = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let s: RegExpExecArray | null;
  while ((s = reSelect.exec(html))) {
    const opcoes: ListaDaTela["opcoes"] = [];
    const reOpcao = /<option\b([^>]*)>([^<]*)/gi;
    let o: RegExpExecArray | null;
    while ((o = reOpcao.exec(s[2]))) {
      const ao = atributos(o[1]);
      const texto = decodificarEntidades(o[2]).replace(/\s+/g, " ").trim();
      // `selected` é um atributo sem valor: procura fora das aspas.
      const marcada = /(?:^|\s)selected(?:\s|=|$)/i.test(o[1].replace(/"[^"]*"|'[^']*'/g, '""'));
      opcoes.push({ valor: ao.value !== undefined ? ao.value : texto, texto, selecionada: marcada });
    }
    // Como no navegador: sem nenhuma marcada, vale a primeira.
    if (opcoes.length && !opcoes.some((op) => op.selecionada)) opcoes[0].selecionada = true;
    listas.push({ nome: atributos(s[1]).name ?? "", opcoes });
  }
  return listas;
}

/** O que cada lista é: de pontos, de semanas ou outra coisa. */
function tipoDaLista(lista: ListaDaTela): "pontos" | "semanas" | "outra" {
  const comValor = lista.opcoes.filter((op) => op.valor !== "");
  if (!comValor.length) return "outra";
  // No máximo UMA opção que não seja do tipo (o “Selecione…” de alguns formulários tem valor 0).
  const pontos = comValor.filter((op) => RE_OPCAO_PONTO.test(op.texto)).length;
  if (pontos && comValor.length - pontos <= 1) return "pontos";
  const semanas = comValor.filter((op) => RE_OPCAO_SEMANA.test(op.texto)).length;
  if (semanas && comValor.length - semanas <= 1) return "semanas";
  return "outra";
}

/**
 * O botão é o do PDF (ou de imprimir / baixar), e não o “Gerar” da tela: pelo
 * texto, pelo nome, ou por mandar o formulário para outro endereço ou outra aba.
 */
function botaoDePdf(texto: string, at: Record<string, string>): boolean {
  return /pdf|imprim|print|baix|download|excel|planilha|xls|csv/i.test(texto) || at.formaction !== undefined || at.formtarget !== undefined;
}

/** Só a ESTRUTURA de um formulário (endereço, método e nomes dos campos): vai para o diagnóstico. */
function estruturaDe(html: string): string[] {
  const limpo = limparHtml(html);
  const saida: string[] = [];
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let f: RegExpExecArray | null;
  let dentro = 0;
  while ((f = reForm.exec(limpo)) && saida.length < 3) {
    const a = atributos(f[1]);
    const listas = listasDe(f[2]);
    dentro += listas.length;
    const campos = [...f[2].matchAll(/<input\b([^>]*?)\/?>/gi)]
      .map((i) => atributos(i[1]))
      .filter((at) => at.name)
      .map((at) => `${(at.name ?? "").slice(0, 24)} (${(at.type ?? "text").toLowerCase()})`);
    saida.push(
      `${(a.method ?? "get").toUpperCase()} ${(a.action || "(a própria página)").split("?")[0].slice(0, 60)} — listas: ${
        listas.map((l) => `${l.nome.slice(0, 24) || "(sem nome)"} [${tipoDaLista(l)}, ${l.opcoes.length}]`).join(", ") || "nenhuma"
      }; campos: ${campos.join(", ").slice(0, 120) || "nenhum"}`,
    );
  }
  const soltas = listasDe(limpo).length - dentro;
  if (soltas > 0) saida.push(`${soltas} lista(s) fora de formulário`);
  if (!saida.length) saida.push("nenhum formulário na tela");
  return saida;
}

/**
 * Acha na tela “2ª Via de Ticket” o formulário da consulta: as DUAS listas
 * (pontos da conta e semanas) e o botão “Gerar”. Para não confundir com um
 * formulário de ação, só vale o que tem exatamente essas duas listas e nada
 * para digitar ou marcar; que não fala de dispensa, exclusão, saída ou senha;
 * e cujo endereço não tem cara de ação (nem de PDF: o “Gerar PDF” fica de fora).
 */
export function extrairFormularioDeTicket(html: string): FormularioDeTicket | FormularioRecusado {
  const limpo = limparHtml(html);
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let f: RegExpExecArray | null;
  let quase: string | null = null;
  while ((f = reForm.exec(limpo))) {
    const a = atributos(f[1]);
    const corpo = f[2];
    const action = a.action ?? "";
    const listas = listasDe(corpo);
    const dePontos = listas.filter((l) => tipoDaLista(l) === "pontos");
    const deSemanas = listas.filter((l) => tipoDaLista(l) === "semanas");
    if (!dePontos.length && !deSemanas.length) continue;
    if (listas.length !== 2 || dePontos.length !== 1 || deSemanas.length !== 1) {
      quase = "o formulário do Ticket não tem só a lista de pontos e a de semanas";
      continue;
    }
    if (!dePontos[0].nome || !deSemanas[0].nome || dePontos[0].nome === deSemanas[0].nome) {
      quase = "as listas do formulário do Ticket não têm nome";
      continue;
    }
    if (enderecoDeAcao(action)) {
      quase = "o formulário do Ticket envia para um endereço com cara de ação";
      continue;
    }
    // Formulário que abre em outra aba é o do PDF, não o da tela.
    if ((a.target ?? "").trim().toLowerCase() === "_blank") {
      quase = "o formulário do Ticket abre em outra aba (é o do PDF, não o da tela)";
      continue;
    }

    const ocultos: { nome: string; valor: string }[] = [];
    /** Botões de envio do formulário: o texto, o nome e se é o do PDF. */
    const botoes: { nome: string; valor: string; dePdf: boolean }[] = [];
    let outroCampo = false;
    for (const i of corpo.matchAll(/<input\b([^>]*?)\/?>/gi)) {
      const at = atributos(i[1]);
      const tipo = (at.type ?? "text").toLowerCase();
      if (tipo === "hidden") {
        if (at.name) ocultos.push({ nome: at.name, valor: at.value ?? "" });
      } else if (tipo === "submit" || tipo === "image") {
        botoes.push({ nome: at.name ?? "", valor: at.value ?? "", dePdf: botaoDePdf(`${at.value ?? ""} ${at.name ?? ""} ${at.alt ?? ""}`, at) });
      } else if (tipo !== "button" && tipo !== "reset") {
        outroCampo = true; // algo para digitar, marcar ou anexar: não é só uma consulta
      }
    }
    if (outroCampo || /<textarea\b/i.test(corpo)) {
      quase = "o formulário do Ticket tem campos além das duas listas";
      continue;
    }
    // Campo escondido que nomeia uma ação (acao=excluir…): fora.
    if (ocultos.some((c) => /^[a-z_\- ]{3,40}$/i.test(c.valor) && enderecoDeAcao(c.valor))) {
      quase = "o formulário do Ticket leva um campo escondido com cara de ação";
      continue;
    }
    for (const b of corpo.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const at = atributos(b[1]);
      if ((at.type ?? "submit").toLowerCase() !== "submit") continue;
      const rotulo = decodificarEntidades(b[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      botoes.push({ nome: at.name ?? "", valor: at.value ?? "", dePdf: botaoDePdf(`${rotulo} ${at.name ?? ""} ${at.value ?? ""}`, at) });
    }
    // Só com o botão do PDF não há como pedir a tela.
    if (botoes.length && botoes.every((b) => b.dePdf)) {
      quase = "o formulário do Ticket só tem o botão do PDF";
      continue;
    }
    // O “Gerar” (o primeiro botão que não é o do PDF); o nome dele só vai no pedido se existir.
    const gerar = botoes.find((b) => !b.dePdf);
    const botao = gerar?.nome ? { nome: gerar.nome, valor: gerar.valor } : null;
    const texto = decodificarEntidades(corpo.replace(/<select\b[\s\S]*?<\/select>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    if (RE_FORMULARIO_DE_ACAO.test(texto)) {
      quase = "o formulário do Ticket fala de uma ação (dispensa, exclusão, senha…)";
      continue;
    }

    const pontos: PontoDoTicket[] = [];
    for (const op of dePontos[0].opcoes) {
      const m = op.valor === "" ? null : RE_OPCAO_PONTO.exec(op.texto);
      if (m) pontos.push({ valor: op.valor, codigo: normalizarCodigoPortal(`${m[1]}${m[2]}`) });
    }
    const semanas: SemanaDoTicket[] = [];
    for (const op of deSemanas[0].opcoes) {
      const m = op.valor === "" ? null : RE_OPCAO_SEMANA.exec(op.texto);
      if (!m) continue;
      const inicio = dataDoPortal(m[1], m[2], m[3]);
      const fim = dataDoPortal(m[4], m[5], m[6]);
      // Uma “semana” de mais de 31 dias (ou de trás para a frente) não é uma semana.
      if (!inicio || !fim || fim < inicio || Date.parse(fim) - Date.parse(inicio) > 31 * 86_400_000) continue;
      semanas.push({ valor: op.valor, inicio, fim, selecionada: op.selecionada });
    }
    if (!pontos.length || !semanas.length) {
      quase = "as listas do formulário do Ticket vieram sem pontos ou sem semanas";
      continue;
    }
    return {
      action,
      method: (a.method ?? "get").toLowerCase() === "post" ? "post" : "get",
      campoPonto: dePontos[0].nome,
      pontos,
      campoSemana: deSemanas[0].nome,
      semanas,
      ocultos,
      botao,
    };
  }

  const todas = listasDe(limpo);
  const temAsDuas = todas.some((l) => tipoDaLista(l) === "pontos") && todas.some((l) => tipoDaLista(l) === "semanas");
  return {
    motivo:
      quase ??
      (temAsDuas
        ? "a tela do Ticket tem as listas de ponto e de semana, mas fora de um formulário (deve enviar por JavaScript)"
        : "não achei na tela do Ticket o formulário com a lista de pontos e a de semanas"),
    estrutura: estruturaDe(html),
  };
}

/**
 * A semana de hoje na lista do portal: a que contém o dia. Num dia que cai em
 * duas (a segunda-feira fecha uma e abre a outra), vale a que o portal deixa
 * marcada; sem marca entre elas, a que começa mais tarde.
 */
export function semanaDeHoje(semanas: SemanaDoTicket[], hoje: string): SemanaDoTicket | null {
  const candidatas = semanas.filter((s) => s.inicio <= hoje && hoje <= s.fim);
  if (!candidatas.length) return null;
  return candidatas.find((s) => s.selecionada) ?? [...candidatas].sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
}

/** Os campos do pedido que o “Gerar” envia: os escondidos, o ponto, a semana e o botão. */
export function montarPedidoDeTicket(form: FormularioDeTicket, valorPonto: string, valorSemana: string): string {
  const campos = new URLSearchParams();
  for (const c of form.ocultos) campos.append(c.nome, c.valor);
  campos.append(form.campoPonto, valorPonto);
  campos.append(form.campoSemana, valorSemana);
  if (form.botao) campos.append(form.botao.nome, form.botao.valor);
  return campos.toString();
}

/* ------------------------------------------------------------ lançamentos */

/** Uma viagem do ticket. */
export type LancamentoDoTicket = {
  /** Código como o portal escreve (A032). */
  ponto: string;
  /** Toneladas. */
  quant: number;
  /** R$ por tonelada. */
  valor: number;
  servico: string;
  /** aaaa-mm-dd */
  data: string;
  /** hh:mm */
  hora: string;
};

export type TicketsDaTela =
  | {
      ok: true;
      /** O período que a tela escreveu (null = não escreveu). */
      periodo: { inicio: string; fim: string } | null;
      /** As viagens, da mais antiga para a mais nova. */
      lancamentos: LancamentoDoTicket[];
    }
  | {
      ok: false;
      motivo: string;
      /** Primeiras linhas do que a tela trouxe, com todo número trocado por 9. */
      amostra: string[];
    };

/** Todo número vira 9: mostra o FORMATO do que veio sem mostrar o valor. */
export const mascararNumeros = (texto: string, limite = 60) => texto.replace(/\d/g, "9").slice(0, limite);

const RE_PERIODO = /(\d{2})\/(\d{2})\/(\d{4})\s*(?:-|–|—|a|à|at[ée])\s*(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_NENHUM = /nenhum\s+(?:lan[çc]amento|ticket|registro)/i;
/** A linha começa com um código de ponto (A032, a032, A32): pode ser a primeira célula de um lançamento. */
const RE_COMECA_COM_PONTO = /^[ABM]-?\d{2,4}(?:\s|$)/i;
/** Código de ponto como o portal escreve (A032, B022), em qualquer lugar da linha. */
const RE_CODIGO_NA_LINHA = /\b[ABM]-?\d{3}\b/;
/**
 * Linha que tem cara de DADO de lançamento sem ter sido lida como um: uma
 * linha inteira com número decimal, data e hora (um lançamento sem o código do
 * ponto na frente), ou uma célula sozinha que é só um número decimal, só uma
 * data ou só uma hora. Nunca é pulada: a tela é recusada.
 */
const RE_DADO_SOLTO = /^(?:\d{1,3}[.,]\d{2,4}|\d{2}\/\d{2}\/\d{4}|\d{1,2}:\d{2}(?::\d{2})?)$/;
const RE_LINHA_COM_DADOS = /\d[.,]\d{2,4}\b.*\b\d{2}\/\d{2}\/\d{4}\b.*\b\d{1,2}:\d{2}\b/;
/** A tela diz que há mais páginas (o leitor só vê a primeira). */
const RE_PAGINA_DE = /\bp[áa]g(?:ina|\.)?\s*\d+\s*(?:de|\/)\s*(\d+)/i;
const RE_MAIS_PAGINAS = /^(?:pr[óo]xim[ao](?:\s+p[áa]gina)?|(?:carregar|mostrar|ver)\s+mais|[»›>]+)$/i;
/**
 * Um lançamento numa linha só: ponto, quant (com ou sem unidade), valor (com
 * ou sem “R$”), o serviço (pode faltar), a data e a hora. O serviço nunca tem
 * uma data dentro: duas linhas coladas não viram um lançamento só.
 */
const RE_LANCAMENTO =
  /^([ABM])\s?-?(\d{1,4})\s+(\d[\d.,]*)\s*(toneladas?|tons?|kg|t)?\s+(?:R\$\s*)?(\d[\d.,]*)\s+(?:((?:(?!\d{2}\/\d{2}\/\d{4}).)*?)\s+)?(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?$/i;
/** As células de uma linha de TABELA, uma a uma (a posição diz o que cada uma é). */
const RE_CELULA_PONTO = /^([ABM])\s?-?(\d{1,4})$/i;
const RE_CELULA_QUANT = /^(\d[\d.,]*)\s*(toneladas?|tons?|kg|t)?$/i;
const RE_CELULA_VALOR = /^(?:R\$\s*)?(\d[\d.,]*)$/i;
const RE_CELULA_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_CELULA_HORA = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Um lançamento como a tela escreveu, antes de conferir os números. */
type LinhaCrua = {
  letra: string;
  numero: string;
  quant: string;
  unidade: string;
  valor: string;
  servico: string;
  dia: string;
  mes: string;
  ano: string;
  hora: string;
  minuto: string;
};

/** A linha inteira (colunas separadas por espaço) é um lançamento? */
function lerLinhaInteira(texto: string): LinhaCrua | null {
  const m = RE_LANCAMENTO.exec(texto);
  if (!m) return null;
  return { letra: m[1], numero: m[2], quant: m[3], unidade: m[4] ?? "", valor: m[5], servico: m[6] ?? "", dia: m[7], mes: m[8], ano: m[9], hora: m[10], minuto: m[11] };
}

/**
 * Linha de tabela que começa com um ponto: as seis células, cada uma no seu
 * lugar. Devolve o lançamento ou o nome da coluna que não serviu.
 */
function lerCelulas(celulas: string[]): LinhaCrua | { coluna: string } {
  const [cPonto, cQuant, cValor, cServico, cData, cHora] = celulas;
  const ponto = RE_CELULA_PONTO.exec(cPonto);
  if (!ponto) return { coluna: "PONTO" };
  const quant = RE_CELULA_QUANT.exec(cQuant);
  if (!quant) return { coluna: "QUANT" };
  const valor = RE_CELULA_VALOR.exec(cValor);
  if (!valor) return { coluna: "VALOR" };
  const data = RE_CELULA_DATA.exec(cData);
  if (!data) return { coluna: "DATA" };
  const hora = RE_CELULA_HORA.exec(cHora);
  if (!hora) return { coluna: "HORA" };
  return { letra: ponto[1], numero: ponto[2], quant: quant[1], unidade: quant[2] ?? "", valor: valor[1], servico: cServico, dia: data[1], mes: data[2], ano: data[3], hora: hora[1], minuto: hora[2] };
}

/** “TOTAL GERAL: 19 VIAGENS - 571.760 TONS” (o rodapé do PDF; a tela pode trazer ou não). */
const RE_TOTAL_VIAGENS = /(\d{1,4})\s*(?:viagens?|lan[çc]amentos?)\b(?:\s*[-–—:]\s*([\d.,]+)\s*(?:tons?|toneladas?|t)\b)?/i;
/** “Total: 7” — só a contagem (um total em dinheiro, “Total: R$ 1.234,56”, não é contagem). */
const RE_TOTAL_SIMPLES = /^total\b[^0-9]{0,30}(\d{1,4})$/i;

const semAcento = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** As palavras de uma linha, para achar o cabeçalho da tabela. */
const palavrasDe = (linha: string) =>
  semAcento(linha)
    .toUpperCase()
    .split(/\s*·\s*|\s+/)
    .map((p) => p.replace(/[.:]+$/, ""))
    .filter(Boolean);

const COLUNAS: readonly RegExp[] = [/^PONTOS?$/, /^(?:QUANT(?:IDADE)?|QTDE?)$/, /^VALOR(?:ES)?$/, /^SERVICOS?$/, /^DATAS?$/, /^HORAS?$/];

/**
 * O cabeçalho PONTO · QUANT · VALOR · SERVIÇO · DATA · HORA começa na linha
 * `i`? Devolve quantas linhas ele ocupa (uma, ou uma por coluna), ou 0.
 */
function linhasDoCabecalho(linhas: string[], i: number): number {
  const palavras: string[] = [];
  for (let k = i; k < linhas.length && k < i + COLUNAS.length; k += 1) {
    palavras.push(...palavrasDe(linhas[k]));
    if (palavras.length > COLUNAS.length) return 0;
    if (!palavras.every((p, n) => COLUNAS[n].test(p))) return 0;
    if (palavras.length === COLUNAS.length) return k - i + 1;
  }
  return 0;
}

/**
 * Quant do ticket, em toneladas: “29.920” (três casas, como no PDF), “29,92”,
 * “30”; com “kg” escrito, quilos. Fora desses formatos, ou fora do que uma
 * carga pesa, não é lido (nunca é adivinhado).
 */
export function lerQuantDoTicket(texto: string, unidade = ""): number | null {
  const t = texto.trim();
  const emQuilos = /^kg$/i.test(unidade.trim());
  let toneladas: number;
  if (/^\d{1,3}[.,]\d{3}$/.test(t)) {
    // 29.920 t (três casas) e 29.920 kg (ponto de milhar) são o mesmo peso.
    toneladas = Number(t.replace(",", "."));
  } else if (/^\d{1,3}(?:[.,]\d{1,2})?$/.test(t)) {
    toneladas = Number(t.replace(",", ".")) / (emQuilos ? 1000 : 1);
  } else if (emQuilos && /^\d{4,6}$/.test(t)) {
    toneladas = Number(t) / 1000;
  } else {
    return null;
  }
  return Number.isFinite(toneladas) && quantPlausivel(toneladas) ? toneladas : null;
}

/** Valor do ticket, em R$ por tonelada: “17.29”, “17,29”, “17”. */
export function lerValorDoTicket(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,3}(?:[.,]\d{1,4})?$/.test(t)) return null;
  const valor = Number(t.replace(",", "."));
  return Number.isFinite(valor) && valorPlausivel(valor) ? valor : null;
}

/**
 * Por que um número não serviu, sem dizer o número: formato desconhecido, zero
 * ou fora do que um ticket traz. Vai para o diagnóstico.
 */
function porQueNaoServe(texto: string, minimo: number, maximo: number, unidade: string): string {
  const t = texto.trim();
  if (!/^\d[\d.,]*$/.test(t) || (t.match(/[.,]/g) ?? []).length > 1) return "formato que a leitura não conhece";
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return "formato que a leitura não conhece";
  if (n === 0) return "zero";
  if (n < minimo) return `menor que ${String(minimo).replace(".", ",")} ${unidade}`;
  if (n > maximo) return `maior que ${maximo} ${unidade}`;
  return "formato que a leitura não conhece";
}

/** “571.760” / “1.200.000” / “1200,5” → toneladas do total (o último separador é o decimal). */
function lerToneladasDoTotal(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d[\d.,]*\d$|^\d$/.test(t)) return null;
  const ult = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  const n = ult < 0 ? Number(t) : Number(`${t.slice(0, ult).replace(/[.,]/g, "")}.${t.slice(ult + 1)}`);
  return Number.isFinite(n) ? n : null;
}

/**
 * Interpreta a tela “Tickets” (o resultado do “Gerar”) para UM ponto e UMA
 * semana. Só vale a tela inteira, com o cabeçalho das seis colunas e, embaixo
 * dele, as viagens — ou o aviso de que não há nenhuma. Ver as regras no topo.
 */
export function interpretarTickets(html: string, esperado: { codigo: string; inicio: string; fim: string }): TicketsDaTela {
  const linhas = linhasDaTela(html);
  const recusa = (motivo: string, de = 0): TicketsDaTela => ({
    ok: false,
    motivo,
    amostra: linhas.slice(de, de + 8).map((l) => mascararNumeros(l)),
  });
  if (!/<\/(?:body|html)\s*>/i.test(html)) return recusa("a página do Ticket veio cortada (sem o fim da página)", Math.max(0, linhas.length - 8));

  // 1) O cabeçalho da tabela.
  let inicioDaTabela = -1;
  let cabecalho = -1;
  for (let i = 0; i < linhas.length; i += 1) {
    const n = linhasDoCabecalho(linhas, i);
    if (n) {
      cabecalho = i;
      inicioDaTabela = i + n;
      break;
    }
  }
  if (cabecalho < 0) {
    // A amostra começa na linha que parece ser o cabeçalho de outra tabela (se houver).
    const parecido = linhas.findIndex((l) => /\bquant|\bvalor\b|\bservi[çc]o/i.test(l));
    return recusa("não achei na tela o quadro de lançamentos (PONTO · QUANT · VALOR · SERVIÇO · DATA · HORA)", Math.max(0, parecido));
  }

  // 2) O período que a tela escreve, antes da tabela: tem de ser o pedido.
  //    Vale o que vem junto da palavra “Período”; sem ela, o único que houver.
  const periodos: { inicio: string; fim: string; rotulado: boolean }[] = [];
  for (let i = 0; i < cabecalho; i += 1) {
    const m = RE_PERIODO.exec(linhas[i]);
    if (!m) continue;
    const inicio = dataDoPortal(m[1], m[2], m[3]);
    const fim = dataDoPortal(m[4], m[5], m[6]);
    if (!inicio || !fim) continue;
    const rotulado = /per[íi]odo|semana/i.test(linhas[i]) || (i > 0 && /^(?:per[íi]odo|semana)\s*:?$/i.test(linhas[i - 1]));
    periodos.push({ inicio, fim, rotulado });
  }
  const distintos = (lista: typeof periodos) => [...new Map(lista.map((x) => [`${x.inicio}|${x.fim}`, x])).values()];
  const comRotulo = distintos(periodos.filter((x) => x.rotulado));
  const escritos = comRotulo.length ? comRotulo : distintos(periodos);
  if (escritos.length > 1) return recusa("a tela escreve mais de um período antes dos lançamentos");
  const periodo: { inicio: string; fim: string } | null = escritos.length ? { inicio: escritos[0].inicio, fim: escritos[0].fim } : null;
  if (periodo && (periodo.inicio !== esperado.inicio || periodo.fim !== esperado.fim)) {
    return recusa(
      `a tela mostra o período ${diaMes(periodo.inicio)} a ${diaMes(periodo.fim)}, e o pedido era ${diaMes(esperado.inicio)} a ${diaMes(esperado.fim)}`,
    );
  }

  // 3) As linhas.
  const lancamentos: LancamentoDoTicket[] = [];
  let avisoDeVazio = false;
  let total: { viagens: number; toneladas: number | null } | null = null;
  let pendente: string[] = [];
  for (let i = inicioDaTabela; i < linhas.length; i += 1) {
    const texto = linhas[i].replace(/\s*·\s*/g, " ").trim();
    // Linha de tabela: as células vêm separadas por “·”.
    const celulas = linhas[i].includes("·") ? linhas[i].split("·").map((c) => c.trim()) : null;
    let crua: LinhaCrua | null = null;
    if (pendente.length) {
      // Uma célula por linha: junta até fechar um lançamento. Outro ponto
      // antes de fechar = o anterior ficou pela metade.
      if (RE_COMECA_COM_PONTO.test(texto)) {
        return recusa(`linha de lançamento que a leitura não entendeu: “${mascararNumeros(pendente.join(" "))}”`, Math.max(0, i - pendente.length));
      }
      pendente.push(texto);
      crua = lerLinhaInteira(pendente.join(" "));
      if (!crua) {
        if (pendente.length >= 8) return recusa(`linha de lançamento que a leitura não entendeu: “${mascararNumeros(pendente.join(" "))}”`, Math.max(0, i - 7));
        continue;
      }
      pendente = [];
    } else if (celulas && RE_CELULA_PONTO.test(celulas[0])) {
      if (celulas.length !== COLUNAS.length) {
        return recusa(`linha com ${celulas.length} colunas (o quadro tem ${COLUNAS.length}): “${mascararNumeros(linhas[i])}”`, i);
      }
      const lida = lerCelulas(celulas);
      if ("coluna" in lida) return recusa(`linha com a coluna ${lida.coluna} que a leitura não entendeu: “${mascararNumeros(linhas[i])}”`, i);
      crua = lida;
    } else {
      crua = lerLinhaInteira(texto);
      if (!crua) {
        if (RE_COMECA_COM_PONTO.test(texto)) {
          pendente = [texto];
        } else if (RE_NENHUM.test(texto)) {
          avisoDeVazio = true;
        } else if (RE_CODIGO_NA_LINHA.test(texto)) {
          return recusa(`linha com um ponto que a leitura não entendeu: “${mascararNumeros(texto)}”`, i);
        } else if (RE_DADO_SOLTO.test(texto) || RE_LINHA_COM_DADOS.test(texto)) {
          return recusa(`linha com cara de lançamento, mas sem o ponto na frente: “${mascararNumeros(texto)}”`, i);
        } else if (RE_MAIS_PAGINAS.test(texto) || Number(RE_PAGINA_DE.exec(texto)?.[1] ?? 1) > 1) {
          return recusa("a tela de lançamentos parece ter mais de uma página (a leitura só vê a primeira)", i);
        } else {
          const t = /total/i.test(texto) ? RE_TOTAL_VIAGENS.exec(texto) : null;
          const simples = t ? null : RE_TOTAL_SIMPLES.exec(texto);
          if (t) total = { viagens: Number(t[1]), toneladas: t[2] ? lerToneladasDoTotal(t[2]) : null };
          else if (simples) total = { viagens: Number(simples[1]), toneladas: null };
        }
        continue;
      }
    }

    const n = lancamentos.length + 1;
    const ponto = normalizarCodigoPortal(`${crua.letra}${crua.numero}`);
    if (ponto !== esperado.codigo) return recusa(`a linha ${n} é de outro ponto (${ponto}), e o pedido era o ${esperado.codigo}`, i);
    const quant = lerQuantDoTicket(crua.quant, crua.unidade);
    if (quant === null) {
      return recusa(
        `linha ${n}: QUANT “${mascararNumeros(`${crua.quant}${crua.unidade ? ` ${crua.unidade}` : ""}`, 24)}” fora do esperado (toneladas, com até três casas): ${porQueNaoServe(crua.quant, 0.5, 80, "t")}`,
        i,
      );
    }
    const valor = lerValorDoTicket(crua.valor);
    if (valor === null) {
      return recusa(
        `linha ${n}: VALOR “${mascararNumeros(crua.valor, 24)}” fora do esperado (R$ por tonelada, com centavos): ${porQueNaoServe(crua.valor, 1, 150, "R$/t")} — serviço “${mascararNumeros(crua.servico, 40)}”`,
        i,
      );
    }
    const data = dataDoPortal(crua.dia, crua.mes, crua.ano);
    if (!data) return recusa(`linha ${n}: data que não existe`, i);
    if (data < esperado.inicio || data > esperado.fim) {
      return recusa(`linha ${n}: a data (${diaMes(data)}) está fora da semana pedida (${diaMes(esperado.inicio)} a ${diaMes(esperado.fim)})`, i);
    }
    const [h, min] = [Number(crua.hora), Number(crua.minuto)];
    if (h > 23 || min > 59) return recusa(`linha ${n}: hora que não existe`, i);
    lancamentos.push({
      ponto,
      quant,
      valor,
      servico: crua.servico.replace(/\s+/g, " ").trim().slice(0, 80),
      data,
      hora: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    });
  }
  if (pendente.length) return recusa(`a tela terminou no meio de um lançamento: “${mascararNumeros(pendente.join(" "))}”`, Math.max(0, linhas.length - 8));

  // 4) A conta tem de fechar.
  if (lancamentos.length && avisoDeVazio) return recusa("a tela trouxe lançamentos e também o aviso de que não há nenhum", inicioDaTabela);
  if (!lancamentos.length && !avisoDeVazio) {
    // Tabela que esta leitura não entendeu nunca vira “nenhuma viagem”.
    return recusa("a tela não trouxe nenhum lançamento nem o aviso de que não há nenhum", inicioDaTabela);
  }
  if (total) {
    if (total.viagens !== lancamentos.length) {
      return recusa(`a tela diz ${total.viagens} viagem(ns) no total, mas trouxe ${lancamentos.length} linha(s)`, inicioDaTabela);
    }
    const soma = lancamentos.reduce((s, l) => s + l.quant, 0);
    if (total.toneladas !== null && Math.abs(total.toneladas - soma) > 0.0015 * Math.max(1, lancamentos.length)) {
      return recusa("as toneladas do total da tela não batem com a soma das linhas", inicioDaTabela);
    }
  }

  // Da mais antiga para a mais nova (a ordem da tela se mantém nos empates).
  const emOrdem = lancamentos
    .map((l, ordem) => ({ l, ordem }))
    .sort((a, b) => `${a.l.data} ${a.l.hora}`.localeCompare(`${b.l.data} ${b.l.hora}`) || a.ordem - b.ordem)
    .map((x) => x.l);
  return { ok: true, periodo, lancamentos: emOrdem };
}

/**
 * Junta o que duas opções da lista com o MESMO código trouxeram (a conta pode
 * ter o mesmo ponto escrito duas vezes): o mesmo lançamento que aparece nas
 * duas conta uma vez; o que se repete dentro de uma só continua repetido.
 */
export function juntarLancamentos(listas: LancamentoDoTicket[][]): LancamentoDoTicket[] {
  const chave = (l: LancamentoDoTicket) => `${l.ponto}|${l.data}|${l.hora}|${l.quant.toFixed(3)}|${l.valor.toFixed(4)}|${l.servico}`;
  const maximo = new Map<string, { l: LancamentoDoTicket; vezes: number }>();
  for (const lista of listas) {
    const nesta = new Map<string, number>();
    for (const l of lista) nesta.set(chave(l), (nesta.get(chave(l)) ?? 0) + 1);
    for (const l of lista) {
      const k = chave(l);
      const atual = maximo.get(k);
      const vezes = nesta.get(k) ?? 1;
      if (!atual || vezes > atual.vezes) maximo.set(k, { l, vezes });
    }
  }
  const saida: LancamentoDoTicket[] = [];
  for (const { l, vezes } of maximo.values()) for (let i = 0; i < vezes; i += 1) saida.push(l);
  return saida.sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`));
}
