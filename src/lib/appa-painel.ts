/**
 * LEITURA DO PAINEL METEOROLÓGICO DA APPA — com FALLBACK AUTOMÁTICO.
 * SOMENTE SERVIDOR: nada aqui roda no navegador do motorista.
 *
 * O painel público do SIMPORT® (Dashboard Meteoceanográfico da APPA) é montado
 * por JavaScript e depende de uma API interna — por isso um único método de
 * leitura nunca é suficiente. Esta é a ordem tentada, sempre do mais confiável
 * e barato para o mais caro:
 *
 *   1. `api`        — JSON embutido na página, endpoints internos (/api, .json)
 *                     e a API estruturada da APPA/SIMPORT (WRF + estação +
 *                     boletim), a mesma que o painel consome;
 *   2. `html`       — requisição HTTP pelo BACKEND + leitura do HTML (tabelas,
 *                     cards e textos, já sem script/estilo);
 *   3. `playwright` — navegador headless no backend: abre a página, espera o
 *                     JavaScript, espera os componentes dinâmicos, rola a
 *                     página e lê o texto renderizado (Playwright, Puppeteer ou
 *                     um navegador externo por CDP — veja APPA_CDP_URL);
 *   4. `ocr`        — captura de tela do navegador + OCR (tesseract.js), para
 *                     painel desenhado em canvas/imagem sem texto no DOM;
 *   5. `composio`   — ferramenta do Composio como método ADICIONAL (nunca o
 *                     único responsável): se ela devolver texto vazio, erro ou
 *                     timeout, o radar já vem dos métodos anteriores.
 *
 * Se o método da vez não consegue ler, o próximo entra automaticamente — o
 * usuário nunca fica só com "ainda não lido pelo Composio". Só quando TODOS
 * falham o radar registra erro (com o motivo de cada tentativa) e segue com a
 * API estruturada do tempo (`src/lib/tempo.ts`).
 *
 * Toda tentativa vira uma linha de log de diagnóstico:
 *
 *   [radar-appa 03/10 09:12:33] método 1/5 API/endpoint de dados: OK em 412 ms (JSON embutido)
 *   [radar-appa 03/10 09:12:34] método 2/5 HTTP + HTML: falhou em 320 ms — HTTP 503
 *
 * O resultado sai no FORMATO ÚNICO de `src/lib/appa-painel-texto.ts`
 * (`DadosPainelAppa`), com `metodo_leitura` preenchido.
 */

import { painelSimportComposio } from "@/lib/composio";
import {
  ROTULO_METODO,
  contarTabelas,
  endpointsDoHtml,
  extrairJsonEmbutido,
  extrairTextoDeHtml,
  leituraFalha,
  normalizarPainelAppa,
  painelDeJson,
  parsearPainelLivre,
  temDadosPainel,
  type DadosPainelAppa,
  type MetodoLeituraAppa,
  type PainelSimport,
  type TentativaLeituraAppa,
} from "@/lib/appa-painel-texto";

export * from "@/lib/appa-painel-texto";

/* ------------------------------------------------------------- constantes */

/** Endereço do painel (troque por variável de ambiente se mudar). */
import { PAINEL_APPA_URL } from "@/lib/appa-painel-texto";
import { obterPrevisao, type Previsao } from "@/lib/tempo";

const CABECALHOS_NAVEGADOR = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

const NOS_PARA_KMH = 1.852;
const TIMEOUT_PADRAO = Math.max(3000, Number(process.env.APPA_LEITURA_TIMEOUT_MS ?? 20000) || 20000);
const TIMEOUT_NAVEGADOR = Math.max(5000, Number(process.env.APPA_NAVEGADOR_TIMEOUT_MS ?? 45000) || 45000);

/* ------------------------------------------------------------------ tipos */

/** Navegador headless já aberto, com o mínimo que a leitura precisa. */
export type NavegadorAppa = {
  /** Nome curto para o log ("playwright", "puppeteer", "cdp"). */
  nome: string;
  /** Texto visível depois do carregamento dinâmico. */
  lerTexto: () => Promise<string>;
  /** Captura de tela (PNG) para o OCR. */
  capturarImagem: () => Promise<Uint8Array>;
  fechar: () => Promise<void>;
};

/** Como abrir o navegador (injetável nos testes). */
export type AbrirNavegadorAppa = (opcoes: {
  url: string;
  timeoutMs: number;
  log: (linha: string) => void;
}) => Promise<NavegadorAppa>;

export type OpcoesLeituraAppa = {
  /** Previsão já lida pelo radar (evita ir de novo à API estruturada). */
  previsao?: Previsao | null;
  /** `fetch` alternativo (testes). */
  buscar?: typeof fetch;
  /** Abre o navegador headless; `null` desliga os métodos 3 e 4. */
  abrirNavegador?: AbrirNavegadorAppa | null;
  /** OCR injetável (testes). */
  ocr?: (imagem: Uint8Array) => Promise<string>;
  /** Leitura pelo Composio (método adicional). */
  lerComposio?: () => Promise<string>;
  /** Linha de log (por padrão vai para o console do servidor). */
  log?: (linha: string) => void;
  /** Momento da leitura (testes). */
  agora?: number;
};

export type ResultadoLeituraAppa = {
  ok: boolean;
  metodo: MetodoLeituraAppa | null;
  normalizado: DadosPainelAppa;
  painel: PainelSimport | null;
  tentativas: TentativaLeituraAppa[];
  /** Motivo detalhado quando TODOS os métodos falharam. */
  erro: string | null;
  /** Texto bruto que sustentou a leitura (limitado; diagnóstico). */
  texto: string;
};

type Captura = { painel: PainelSimport; texto: string; detalhe?: string };

type Contexto = {
  buscar: typeof fetch;
  timeoutMs: number;
  url: string;
  log: (linha: string) => void;
  html: { em: number; texto: string } | null;
  erroHtml: string | null;
  navegador: NavegadorAppa | null;
  abrirNavegador: AbrirNavegadorAppa | null;
  ocr: (imagem: Uint8Array) => Promise<string>;
  lerComposio: () => Promise<string>;
  previsao: Previsao | null | undefined;
};

/* ------------------------------------------------------------- utilidades */

/**
 * Carimbo do log de diagnóstico: `03/10 09:12:33` no horário de Brasília (o
 * mesmo do porto). É o começo de cada linha: `[radar-appa 03/10 09:12:33] …`.
 */
function carimbo(agora: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(agora))
      .replace(",", "");
  } catch {
    return new Date(agora).toISOString().slice(11, 19);
  }
}

/** Prefixo padrão das linhas de diagnóstico do radar da APPA. */
function prefixoLog(agora: number = Date.now()): string {
  return `[radar-appa ${carimbo(agora)}]`;
}

function motivoDe(e: unknown): string {
  if (e instanceof Error) return (e.message || e.name || "erro").replace(/\s+/g, " ").trim().slice(0, 200);
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message).slice(0, 200);
  return String(e).slice(0, 200);
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const r1 = (n: number) => Math.round(n * 10) / 10;

/** "14h" → "14:00" (o formato das tabelas do painel). */
function horaDaPrevisao(hora: string): string {
  const m = String(hora).match(/(\d{1,2})(?::(\d{2}))?/);
  if (!m) return String(hora);
  return `${m[1].padStart(2, "0")}:${(m[2] ?? "00").padStart(2, "0")}`;
}

/** Previsão já montada pelo app → mesmo `PainelSimport` dos outros métodos. */
export function painelDaPrevisao(p: Previsao, agoraMs: number = Date.now()): PainelSimport {
  const horas = p.horas
    .filter((h) => h.ts * 1000 >= agoraMs - 30 * 60_000)
    .slice(0, 24);
  const chuva: PainelSimport["chuva"] = horas.map((h) => ({
    hora: horaDaPrevisao(h.hora),
    mm: h.chuvaMm,
    prob: h.chanceChuva,
  }));
  const vento: PainelSimport["vento"] = horas.map((h) => ({
    hora: horaDaPrevisao(h.hora),
    nos: r1(h.ventoKmh / NOS_PARA_KMH),
    direcao: h.ventoDirecao,
  }));
  const alertas: string[] = [];
  if (p.alerta && p.alerta.nivel !== "tempo-bom") {
    alertas.push(`${p.alerta.titulo}: ${p.alerta.texto}`.slice(0, 180));
  }
  for (const b of p.boletim ?? []) {
    if (/temporal|tempestade|trovoada|chuva forte|vendaval|rajada/i.test(b.texto)) {
      alertas.push(`${b.data}: ${b.texto.slice(0, 150)}`);
    }
  }
  return {
    boletim: (p.boletim ?? []).map((b) => ({
      dia: b.data.split("-").reverse().slice(0, 2).join("/"),
      texto: b.texto,
    })),
    chuva,
    vento,
    mares: [],
    nascerSol: p.nascerSol,
    porSol: p.porSol,
    alertas: [...new Set(alertas)].slice(0, 6),
    agora: {
      temperatura: p.agora.temperatura,
      sensacao: p.agora.sensacao,
      umidade: p.agora.umidade,
      ventoNos: r1(p.agora.ventoKmh / NOS_PARA_KMH),
      direcao: p.agora.ventoDirecao,
      pressao: null,
    },
  };
}

/* ------------------------------------------------------ download do painel */

/** HTML do painel, buscado UMA vez por leitura e reaproveitado nos métodos 1 e 2. */
async function baixarHtml(ctx: Contexto): Promise<string> {
  if (ctx.html) return ctx.html.texto;
  const enderecos = [...new Set([ctx.url, ctx.url.replace(/\/+$/, "") + "/forecast"])];
  const erros: string[] = [];
  for (const endereco of enderecos) {
    try {
      const r = await ctx.buscar(endereco, {
        headers: CABECALHOS_NAVEGADOR,
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (html.trim().length < 200) throw new Error(`resposta curta (${html.trim().length} caracteres)`);
      ctx.html = { em: Date.now(), texto: html };
      return html;
    } catch (e) {
      erros.push(`${new URL(endereco).pathname || "/"}: ${motivoDe(e)}`);
    }
  }
  ctx.erroHtml = erros.join(" · ");
  throw new Error(`não foi possível baixar a página (${ctx.erroHtml})`);
}

async function buscarJson(ctx: Contexto, endereco: string): Promise<unknown> {
  const r = await ctx.buscar(endereco, {
    headers: { ...CABECALHOS_NAVEGADOR, Accept: "application/json,*/*" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    return texto.slice(0, 200_000);
  }
}

/* ------------------------------------------------ MÉTODO 1: API / dados */

async function metodoApi(ctx: Contexto): Promise<Captura> {
  const notas: string[] = [];

  // (a) JSON já embutido na página. (b) Endpoints internos citados no HTML.
  let html = "";
  try {
    html = await baixarHtml(ctx);
  } catch (e) {
    notas.push(`página HTTP indisponível (${motivoDe(e)})`);
  }
  if (html) {
    const jsons = extrairJsonEmbutido(html);
    for (const j of jsons) {
      const p = painelDeJson(j);
      if (p && temDadosPainel(p)) {
        return {
          painel: p,
          texto: JSON.stringify(j).slice(0, 200_000),
          detalhe: "dados JSON embutidos na página",
        };
      }
    }
    if (jsons.length) notas.push(`${jsons.length} bloco(s) JSON sem dado meteorológico`);

    const endpoints = endpointsDoHtml(html, ctx.url);
    for (const endereco of endpoints) {
      try {
        const j = await buscarJson(ctx, endereco);
        const p = painelDeJson(j) ?? (typeof j === "string" ? parsearPainelLivre(j) : null);
        if (p && temDadosPainel(p)) {
          return {
            painel: p,
            texto: typeof j === "string" ? j.slice(0, 200_000) : JSON.stringify(j).slice(0, 200_000),
            detalhe: `endpoint interno ${new URL(endereco).pathname}`,
          };
        }
        notas.push(`${new URL(endereco).pathname}: respondeu, mas sem dado meteorológico`);
      } catch (e) {
        notas.push(`${new URL(endereco).pathname}: ${motivoDe(e)}`);
      }
    }
    if (!endpoints.length) notas.push("nenhum endpoint/JSON encontrado no HTML");
  }

  // (c) API estruturada da APPA/SIMPORT — a mesma fonte que alimenta o painel
  // (WRF hora a hora, estação do porto e boletim). Fonte preferencial.
  try {
    const previsao = ctx.previsao ?? (await obterPrevisao(false));
    if (previsao && (previsao.fontes.simport || previsao.fontes.estacao)) {
      const painel = painelDaPrevisao(previsao);
      if (temDadosPainel(painel)) {
        return {
          painel,
          texto: "",
          detalhe: "API estruturada SIMPORT/APPA (WRF + estação + boletim)",
        };
      }
      notas.push("API estruturada respondeu sem dados utilizáveis");
    } else {
      notas.push("API estruturada da APPA indisponível agora");
    }
  } catch (e) {
    notas.push(`API estruturada: ${motivoDe(e)}`);
  }

  throw new Error(notas.join(" · ") || "nenhuma fonte de dados JSON encontrada");
}

/* ---------------------------------------------- MÉTODO 2: HTTP + HTML */

async function metodoHtml(ctx: Contexto): Promise<Captura> {
  const html = await baixarHtml(ctx);
  const texto = extrairTextoDeHtml(html);
  const tabelas = contarTabelas(html);
  if (texto.trim().length < 60) {
    throw new Error(`página traz pouquíssimo texto visível (${texto.trim().length} caracteres, ${tabelas} tabela(s))`);
  }
  const painel = parsearPainelLivre(texto);
  if (!painel || !temDadosPainel(painel)) {
    throw new Error(
      `HTML lido (${texto.trim().length} caracteres, ${tabelas} tabela(s)), mas sem dados meteorológicos identificáveis — provável página montada por JavaScript`,
    );
  }
  return { painel, texto, detalhe: `${tabelas} tabela(s) HTML · ${texto.trim().length} caracteres` };
}

/* ------------------------------- MÉTODO 3: navegador headless (Playwright) */

async function abrirNavegador(ctx: Contexto): Promise<NavegadorAppa> {
  if (ctx.navegador) return ctx.navegador;
  if (!ctx.abrirNavegador) throw new Error("navegador headless desligado nesta execução");
  ctx.navegador = await ctx.abrirNavegador({ url: ctx.url, timeoutMs: TIMEOUT_NAVEGADOR, log: ctx.log });
  return ctx.navegador;
}

async function metodoNavegador(ctx: Contexto): Promise<Captura> {
  const navegador = await abrirNavegador(ctx);
  const texto = await navegador.lerTexto();
  if (texto.trim().length < 60) {
    throw new Error(`navegador abriu a página, mas o texto visível continua vazio (${texto.trim().length} caracteres)`);
  }
  const painel = parsearPainelLivre(texto);
  if (!painel || !temDadosPainel(painel)) {
    throw new Error(`navegador leu ${texto.trim().length} caracteres, mas sem dados meteorológicos identificáveis`);
  }
  return { painel, texto, detalhe: `${navegador.nome} · ${texto.trim().length} caracteres renderizados` };
}

/* -------------------------------------- MÉTODO 4: captura de tela + OCR */

async function metodoOcr(ctx: Contexto): Promise<Captura> {
  const navegador = await abrirNavegador(ctx);
  const imagem = await navegador.capturarImagem();
  if (!imagem || imagem.byteLength < 1000) throw new Error("captura de tela vazia");
  const texto = await ctx.ocr(imagem);
  if (texto.trim().length < 20) throw new Error("OCR não reconheceu texto na captura de tela");
  const painel = parsearPainelLivre(texto);
  if (!painel || !temDadosPainel(painel)) {
    throw new Error(`OCR reconheceu ${texto.trim().length} caracteres, mas sem dados meteorológicos identificáveis`);
  }
  return { painel, texto, detalhe: `OCR · ${imagem.byteLength} bytes · ${texto.trim().length} caracteres` };
}

/* ------------------------------------------------ MÉTODO 5: Composio */

async function metodoComposio(ctx: Contexto): Promise<Captura> {
  const bruto = await ctx.lerComposio();
  const texto = (bruto ?? "").trim();
  if (!texto) throw new Error("Composio devolveu texto vazio");
  const painel = parsearPainelLivre(texto);
  if (!painel || !temDadosPainel(painel)) {
    throw new Error(`Composio devolveu ${texto.length} caracteres, mas sem dados meteorológicos identificáveis`);
  }
  return { painel, texto, detalhe: `Composio · ${texto.length} caracteres` };
}

/* ------------------------------------------- navegador headless padrão */

type PaginaNavegador = {
  goto?: (url: string, opcoes?: Record<string, unknown>) => Promise<unknown>;
  waitForLoadState?: (estado?: string, opcoes?: Record<string, unknown>) => Promise<unknown>;
  waitForNetworkIdle?: (idleTime?: number, timeout?: number) => Promise<unknown>;
  evaluate: (expressao: string) => Promise<unknown>;
  screenshot?: (opcoes?: Record<string, unknown>) => Promise<unknown>;
  close?: () => Promise<unknown>;
  setViewportSize?: (t: { width: number; height: number }) => Promise<unknown>;
  setViewport?: (t: { width: number; height: number }) => Promise<unknown>;
};

type NavegadorAberto = {
  newPage: () => Promise<PaginaNavegador>;
  close?: () => Promise<unknown>;
};

type TecnicaNavegador = {
  launch: (opcoes?: Record<string, unknown>) => Promise<NavegadorAberto>;
  connectOverCDP?: (url: string, opcoes?: Record<string, unknown>) => Promise<NavegadorAberto>;
};

type ModuloNavegador = {
  chromium?: TecnicaNavegador;
  firefox?: TecnicaNavegador;
  puppeteer?: TecnicaNavegador;
  default?: ModuloNavegador;
};

/** Nomes de módulo tentados, na ordem (dá para fixar com APPA_NAVEGADOR_MODULO). */
function modulosDoNavegador(): string[] {
  const escolhido = process.env.APPA_NAVEGADOR_MODULO?.trim();
  if (escolhido) return escolhido.split(",").map((s) => s.trim()).filter(Boolean);
  return ["playwright", "playwright-core", "puppeteer", "puppeteer-core"];
}

/**
 * Importa o módulo do navegador em tempo de execução, sem o empacotador do
 * Next tentar resolvê-lo no build (Playwright é opcional na infraestrutura).
 */
function importarEmTempoDeExecucao(nome: string): Promise<unknown> {
  const carregar = new Function("nome", "return import(nome)") as (n: string) => Promise<unknown>;
  return carregar(nome);
}

const paraBytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return new Uint8Array(0);
};

/**
 * Espera o conteúdo dinâmico aparecer, devolvendo o melhor texto visto.
 * Exportado para os testes: é a garantia de que a página NÃO é considerada
 * vazia antes do carregamento dinâmico terminar.
 */
export async function esperarConteudo(
  ler: () => Promise<string>,
  minimo: number,
  timeoutMs: number,
  intervaloMs = 1500,
): Promise<string> {
  const fim = Date.now() + timeoutMs;
  let melhor = "";
  let ultimoErro: unknown = null;
  do {
    try {
      const texto = await ler();
      if (texto.length > melhor.length) melhor = texto;
      if (texto.trim().length >= minimo) return texto;
    } catch (e) {
      ultimoErro = e;
    }
    if (Date.now() < fim) await espera(intervaloMs);
  } while (Date.now() < fim);
  if (!melhor && ultimoErro) throw new Error(motivoDe(ultimoErro));
  return melhor;
}

/**
 * Abre a página no navegador headless disponível na infraestrutura
 * (Playwright, Puppeteer ou um navegador externo por CDP/APPA_CDP_URL):
 * carrega, espera o JavaScript, espera os componentes dinâmicos, rola a página
 * e devolve o texto renderizado — além da captura de tela para o OCR.
 */
export async function abrirNavegadorPadrao(opcoes: {
  url: string;
  timeoutMs: number;
  log: (linha: string) => void;
}): Promise<NavegadorAppa> {
  const erros: string[] = [];
  let modulo: ModuloNavegador | null = null;
  let nomeModulo = "";
  for (const nome of modulosDoNavegador()) {
    try {
      modulo = (await importarEmTempoDeExecucao(nome)) as ModuloNavegador;
      nomeModulo = nome;
      break;
    } catch (e) {
      erros.push(`${nome}: ${motivoDe(e)}`);
    }
  }
  if (!modulo) {
    throw new Error(
      `nenhum navegador headless instalado (${erros.join(" · ")}). Instale o Playwright ou defina APPA_NAVEGADOR_MODULO/APPA_CDP_URL`,
    );
  }
  const tecnica =
    modulo.chromium ?? modulo.puppeteer ?? modulo.default?.chromium ?? modulo.default?.puppeteer ?? modulo.firefox;
  if (!tecnica) throw new Error(`${nomeModulo} não expõe chromium/puppeteer`);

  const cdp = process.env.APPA_CDP_URL?.trim() || process.env.APPA_NAVEGADOR_URL?.trim() || "";
  const nome = cdp ? `cdp(${nomeModulo})` : nomeModulo;
  opcoes.log(`${prefixoLog()} navegador headless: ${nome}${cdp ? " (navegador externo)" : ""}`);

  const navegador =
    cdp && tecnica.connectOverCDP
      ? await tecnica.connectOverCDP(cdp, { timeout: opcoes.timeoutMs })
      : await tecnica.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=pt-BR"],
        });

  const pagina = await navegador.newPage();
  await Promise.resolve(pagina.setViewportSize?.({ width: 1366, height: 900 }) ?? null).catch(() => null);
  await Promise.resolve(pagina.setViewport?.({ width: 1366, height: 900 }) ?? null).catch(() => null);

  const lerTextoPagina = async () =>
    String((await pagina.evaluate("document.body ? document.body.innerText : ''")) ?? "");

  const fechar = async () => {
    await Promise.resolve(pagina.close?.() ?? null).catch(() => null);
    await Promise.resolve(navegador.close?.() ?? null).catch(() => null);
  };

  try {
    if (!pagina.goto) throw new Error("página do navegador sem goto");
    await pagina.goto(opcoes.url, { waitUntil: "domcontentloaded", timeout: opcoes.timeoutMs });
    opcoes.log(`${prefixoLog()} navegador: página aberta; aguardando o JavaScript…`);
    await Promise.resolve(pagina.waitForLoadState?.("networkidle", { timeout: 15000 }) ?? null).catch(() => null);
    await Promise.resolve(pagina.waitForNetworkIdle?.(1200, 15000) ?? null).catch(() => null);

    // Componentes dinâmicos: só considera "vazio" depois de esperar de verdade.
    let texto = await esperarConteudo(lerTextoPagina, 120, Math.min(20000, opcoes.timeoutMs));

    // Rolagem para forçar o carregamento do que só aparece na tela.
    await Promise.resolve(
      pagina.evaluate(
        `(async () => {
           const passo = Math.max(400, Math.floor(window.innerHeight * 0.8));
           for (let y = 0; y < Math.min(document.body.scrollHeight, 20000); y += passo) {
             window.scrollTo(0, y);
             await new Promise((r) => setTimeout(r, 200));
           }
           window.scrollTo(0, 0);
           return true;
         })()`,
      ) ?? null,
    ).catch(() => null);

    const depoisDaRolagem = await esperarConteudo(lerTextoPagina, 120, 8000);
    if (depoisDaRolagem.trim().length > texto.trim().length) texto = depoisDaRolagem;
    if (texto.trim().length < 120) {
      // Última espera: alguns painéis demoram mais que o normal.
      const ultima = await esperarConteudo(lerTextoPagina, 120, 8000);
      if (ultima.trim().length > texto.trim().length) texto = ultima;
    }
    opcoes.log(`${prefixoLog()} navegador: ${texto.trim().length} caracteres renderizados`);
    return {
      nome,
      lerTexto: async () => texto,
      capturarImagem: async () => {
        if (!pagina.screenshot) throw new Error("navegador sem captura de tela");
        return paraBytes(await pagina.screenshot({ fullPage: true, type: "png" }));
      },
      fechar,
    };
  } catch (e) {
    await fechar();
    throw e;
  }
}

/* ------------------------------------------------------------- OCR padrão */

type TrabalhadorOcr = {
  recognize: (imagem: unknown) => Promise<{ data?: { text?: string } }>;
  terminate?: () => Promise<unknown>;
};
type CriarOcr = (idiomas?: string, oem?: number, opcoes?: Record<string, unknown>) => Promise<TrabalhadorOcr>;
type ModuloOcr = { createWorker?: CriarOcr; default?: { createWorker?: CriarOcr } };

/**
 * OCR da captura de tela: usa um serviço externo quando APPA_OCR_URL estiver
 * definida (bom para serverless) ou o tesseract.js, que já é dependência do
 * aplicativo (é o mesmo leitor da foto do ticket, em `FreteApp`).
 */
export async function ocrPadrao(imagem: Uint8Array): Promise<string> {
  const servico = process.env.APPA_OCR_URL?.trim();
  if (servico) {
    const r = await fetch(servico, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(imagem),
      signal: AbortSignal.timeout(TIMEOUT_NAVEGADOR),
    });
    if (!r.ok) throw new Error(`serviço de OCR respondeu HTTP ${r.status}`);
    const tipo = r.headers.get("content-type") ?? "";
    if (tipo.includes("json")) {
      const j = (await r.json()) as { texto?: string; text?: string };
      return String(j.texto ?? j.text ?? "");
    }
    return await r.text();
  }

  const mod = (await import("tesseract.js")) as ModuloOcr;
  const criar = mod.createWorker ?? mod.default?.createWorker;
  if (!criar) throw new Error("tesseract.js indisponível para o OCR");
  const idioma = process.env.APPA_OCR_IDIOMA?.trim() || "por+eng";
  let trabalhador: TrabalhadorOcr;
  try {
    trabalhador = await criar(idioma);
  } catch {
    trabalhador = await criar("eng");
  }
  try {
    const { data } = await trabalhador.recognize(Buffer.from(imagem));
    return String(data?.text ?? "");
  } finally {
    await Promise.resolve(trabalhador.terminate?.() ?? null).catch(() => null);
  }
}

/* ------------------------------------------------------- orquestração */

function criarContexto(opcoes: OpcoesLeituraAppa): Contexto {
  return {
    buscar: opcoes.buscar ?? fetch,
    timeoutMs: TIMEOUT_PADRAO,
    url: PAINEL_APPA_URL,
    // As linhas já saem com o carimbo do prefixoLog (fora do console do teste).
  log: opcoes.log ?? ((linha: string) => console.info(linha)),
    html: null,
    erroHtml: null,
    navegador: null,
    abrirNavegador: opcoes.abrirNavegador === undefined ? abrirNavegadorPadrao : opcoes.abrirNavegador,
    ocr: opcoes.ocr ?? ocrPadrao,
    lerComposio: opcoes.lerComposio ?? (() => painelSimportComposio()),
    previsao: opcoes.previsao,
  };
}

const METODOS: { metodo: MetodoLeituraAppa; ler: (ctx: Contexto) => Promise<Captura> }[] = [
  { metodo: "api", ler: metodoApi },
  { metodo: "html", ler: metodoHtml },
  { metodo: "playwright", ler: metodoNavegador },
  { metodo: "ocr", ler: metodoOcr },
  { metodo: "composio", ler: metodoComposio },
];

/**
 * Lê o painel da APPA tentando TODOS os métodos, em ordem, até um funcionar.
 * Nunca joga erro para cima: quando todos falham devolve `ok: false` com o
 * motivo de cada tentativa (o radar segue com a API estruturada do tempo).
 */
export async function lerPainelAppa(opcoes: OpcoesLeituraAppa = {}): Promise<ResultadoLeituraAppa> {
  const ctx = criarContexto(opcoes);
  const tentativas: TentativaLeituraAppa[] = [];
  try {
    for (const [i, alvo] of METODOS.entries()) {
      const inicio = Date.now();
      const em = new Date(inicio).toISOString();
      try {
        const captura = await alvo.ler(ctx);
        const ms = Date.now() - inicio;
        const normalizado = normalizarPainelAppa(captura.painel, {
          metodo: alvo.metodo,
          agora: Date.now(),
          textoBruto: captura.texto || ctx.html?.texto || "",
        });
        const caracteres = captura.texto.trim().length || (ctx.html?.texto.length ?? 0);
        tentativas.push({
          metodo: alvo.metodo,
          rotulo: ROTULO_METODO[alvo.metodo],
          ordem: i + 1,
          ok: true,
          em,
          ms,
          motivo: `ok · ${caracteres} caracteres e ${captura.painel.chuva.length + captura.painel.vento.length} linha(s) de previsão`,
          caracteres,
          ...(captura.detalhe ? { detalhe: captura.detalhe } : {}),
        });
        ctx.log(
          `${prefixoLog()} método ${i + 1}/${METODOS.length} ${ROTULO_METODO[alvo.metodo]}: OK em ${ms} ms` +
            (captura.detalhe ? ` (${captura.detalhe})` : ""),
        );
        return {
          ok: true,
          metodo: alvo.metodo,
          normalizado,
          painel: captura.painel,
          tentativas,
          erro: null,
          texto: captura.texto.slice(0, 4000),
        };
      } catch (e) {
        const ms = Date.now() - inicio;
        const motivo = motivoDe(e);
        tentativas.push({
          metodo: alvo.metodo,
          rotulo: ROTULO_METODO[alvo.metodo],
          ordem: i + 1,
          ok: false,
          em,
          ms,
          motivo,
          caracteres: 0,
        });
        ctx.log(
          `${prefixoLog()} método ${i + 1}/${METODOS.length} ${ROTULO_METODO[alvo.metodo]}: falhou em ${ms} ms — ${motivo}`,
        );
      }
    }
    const erro = `todos os ${METODOS.length} métodos falharam: ${tentativas
      .map((t) => `${t.rotulo} (${t.motivo})`)
      .join("; ")}`.slice(0, 480);
    ctx.log(`${prefixoLog()} painel da APPA NÃO lido — ${erro}`);
    return {
      ok: false,
      metodo: null,
      normalizado: leituraFalha(opcoes.agora),
      painel: null,
      tentativas,
      erro,
      texto: "",
    };
  } finally {
    if (ctx.navegador) await ctx.navegador.fechar().catch(() => null);
  }
}

/** Linha curta com o resultado das tentativas (para o status e o log do cron). */
export function resumoDasTentativas(tentativas: TentativaLeituraAppa[]): string {
  if (!tentativas.length) return "nenhuma tentativa registrada";
  const ok = tentativas.find((t) => t.ok);
  if (ok) return `${ok.rotulo} · ${Math.round(ok.ms)} ms`;
  return `sem leitura: ${tentativas.map((t) => `${t.rotulo}: ${t.motivo}`).join("; ")}`.slice(0, 300);
}
