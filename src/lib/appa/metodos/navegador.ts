import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resumirPainel } from "../analise";
import { leituraCompleta, leituraUtil, parsearPainelSimport } from "../painel";
import { ErroMetodo, type PainelSimport, type SaidaMetodo, type Sinais } from "../tipos";
import { painelDeDadosSimport, type DadosSimport } from "./api";

/**
 * MÉTODO 3 — navegador automático (Playwright + Chromium headless).
 *
 * Abre o painel como um navegador de verdade, espera a página se montar por
 * JavaScript (nunca a chama de "vazia" antes do carregamento dinâmico), rola
 * até o fim para disparar componentes carregados sob demanda e captura:
 *   - o texto renderizado, as tabelas e os cartões da tela;
 *   - as respostas JSON (XHR/fetch) que a própria página recebeu — a mesma API
 *     do método 1, só que com o token que o site realmente usa;
 *   - uma captura de tela inteira, reaproveitada pelo método 4 (OCR).
 *
 * O Chromium é opcional e escolhido assim (o primeiro que subir vale):
 *   1. APPA_BROWSER_WS         navegador remoto (Browserless etc., via CDP);
 *   2. APPA_CHROMIUM_PATH      executável local (Docker, servidor próprio);
 *   3. @sparticuz/chromium-min Chromium para Vercel/AWS Lambda (baixa o pacote);
 *   4. caminhos comuns do sistema (chromium, google-chrome…);
 *   5. o Chromium que o próprio Playwright instalou, se existir.
 * Sem nenhum deles o método falha com mensagem clara e o fallback segue.
 */

/* ----------------------------------------------------- tipos mínimos do Playwright */
export interface RespostaLike {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  request(): { resourceType(): string };
  json(): Promise<unknown>;
}

export interface PaginaLike {
  goto(url: string, opcoes: { waitUntil: "domcontentloaded" | "load"; timeout: number }): Promise<unknown>;
  reload?(opcoes: { waitUntil: "domcontentloaded" | "load"; timeout: number }): Promise<unknown>;
  waitForLoadState(estado: "load" | "networkidle", opcoes: { timeout: number }): Promise<void>;
  waitForFunction(expressao: string, arg: undefined, opcoes: { timeout: number; polling?: number }): Promise<unknown>;
  evaluate<T = unknown>(expressao: string): Promise<T>;
  screenshot(opcoes: { fullPage: boolean; type: "png" }): Promise<Buffer>;
  content(): Promise<string>;
  on(evento: "response", ouvinte: (r: RespostaLike) => void): void;
}

export type Sessao = { pagina: PaginaLike; fechar: () => Promise<void>; descricao: string };
export type AbridorDePagina = (restanteMs: number) => Promise<Sessao>;

export type CapturaNavegador = {
  url: string;
  texto: string;
  html: string;
  tabelas: string[][][];
  cartoes: string[];
  titulos: string[];
  /** Respostas JSON (XHR/fetch) que a página recebeu. */
  json: { url: string; corpo: unknown }[];
  screenshot: Buffer | null;
  duracaoMs: number;
  avisos: string[];
  /** A página mostrou algum conteúdo reconhecível do painel. */
  renderizou: boolean;
  navegador: string;
};

/* --------------------------------------------------------- scripts da página */
// Em texto de propósito: o transpilador não injeta ajudantes (ex.: __name) que o navegador não conhece.
const JS_TEM_CONTEUDO = `(() => {
  const t = (document.body && document.body.innerText) || "";
  return t.length > 200 && /(previs[ãa]o de (chuvas|ventos)|umidade|press[ãa]o|\\d{1,2}\\s*°\\s*c)/i.test(t);
})()`;

const JS_ROLAR = `(async () => {
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const passo = Math.max(400, Math.round(window.innerHeight * 0.8));
  let y = 0;
  for (let i = 0; i < 14; i++) {
    window.scrollTo(0, y);
    await pausa(220);
    if (y >= document.documentElement.scrollHeight) break;
    y += passo;
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
  await pausa(300);
  window.scrollTo(0, 0);
  return document.documentElement.scrollHeight;
})()`;

const JS_TAMANHO_TEXTO = `(document.body ? document.body.innerText.length : 0)`;

const JS_CAPTURAR = `(() => {
  const limpa = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const tabelas = Array.from(document.querySelectorAll("table")).slice(0, 12).map((t) =>
    Array.from(t.rows).slice(0, 80).map((r) => Array.from(r.cells).map((c) => limpa(c.innerText))));
  const cartoes = Array.from(document.querySelectorAll("[class*=card],[class*=Card],[class*=widget],[class*=tile],[class*=panel],section,article"))
    .map((e) => limpa(e.innerText)).filter((t) => t.length > 3 && t.length < 200 && /\\d/.test(t)).slice(0, 40);
  const titulos = Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((h) => limpa(h.innerText)).filter(Boolean).slice(0, 40);
  return { texto: document.body ? document.body.innerText : "", tabelas, cartoes, titulos };
})()`;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Promessa com prazo: se estourar, devolve o motivo em vez de ficar pendurada. */
function comPrazo<T>(p: Promise<T>, ms: number, motivo: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(motivo)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/* ----------------------------------------------------------- captura da página */
export async function capturarPagina(opcoes: {
  url: string;
  timeoutMs: number;
  screenshot: boolean;
  /** Troca o navegador real (testes). */
  abrir?: AbridorDePagina;
}): Promise<CapturaNavegador> {
  const inicio = Date.now();
  const limite = inicio + opcoes.timeoutMs;
  const restante = () => Math.max(0, limite - Date.now());
  const avisos: string[] = [];
  const json: CapturaNavegador["json"] = [];
  const pendentes: Promise<unknown>[] = [];

  const sessao = await (opcoes.abrir ?? abrirNavegador)(restante());
  const { pagina } = sessao;
  try {
    // As respostas JSON que a página recebe (a API do painel) valem mais que OCR.
    pagina.on("response", (resp) => {
      try {
        if (json.length + pendentes.length >= 40) return;
        const tipo = resp.request().resourceType();
        if (tipo !== "xhr" && tipo !== "fetch") return;
        if (!/json/i.test(resp.headers()["content-type"] ?? "") || resp.status() >= 400) return;
        pendentes.push(
          resp
            .json()
            .then((corpo) => json.push({ url: resp.url(), corpo }))
            .catch(() => null),
        );
      } catch {
        /* resposta já descartada pelo navegador */
      }
    });

    // 1) Abre a página (até duas tentativas).
    let abriu = false;
    let ultimoErro = "";
    for (let t = 1; t <= 2 && restante() > 2500; t++) {
      try {
        await pagina.goto(opcoes.url, { waitUntil: "domcontentloaded", timeout: Math.min(restante(), t === 1 ? 14_000 : 9_000) });
        abriu = true;
        break;
      } catch (e) {
        ultimoErro = e instanceof Error ? e.message.split("\n")[0] : String(e);
        avisos.push(`tentativa ${t} de abrir a página falhou (${ultimoErro})`);
        await pausa(400);
      }
    }
    if (!abriu) throw new ErroMetodo(`o navegador não conseguiu abrir a página (${ultimoErro || "sem tempo"})`);

    // 2) Espera a rede acalmar (melhor esforço: painéis que atualizam sozinhos nunca ficam ociosos).
    await pagina
      .waitForLoadState("networkidle", { timeout: Math.min(restante(), 6000) })
      .catch(() => avisos.push("a rede não ficou ociosa; seguindo com o que já carregou"));

    // 3) Espera o conteúdo dinâmico aparecer. Só depois disso a página pode ser dita "vazia".
    const aparece = () =>
      pagina
        .waitForFunction(JS_TEM_CONTEUDO, undefined, { timeout: Math.min(restante(), 10_000), polling: 250 })
        .then(() => true)
        .catch(() => false);
    let renderizou = await aparece();
    if (!renderizou && pagina.reload && restante() > 6000) {
      avisos.push("o painel não apareceu a tempo; recarregando a página");
      try {
        await pagina.reload({ waitUntil: "domcontentloaded", timeout: Math.min(restante(), 9000) });
        renderizou = await aparece();
      } catch (e) {
        avisos.push(`o recarregamento falhou (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
      }
    }

    // 4) Rola a página inteira: componentes carregados sob demanda só montam quando aparecem.
    if (restante() > 1500) {
      await comPrazo(pagina.evaluate(JS_ROLAR), Math.min(restante(), 8000), "a rolagem demorou demais").catch((e) =>
        avisos.push(String(e instanceof Error ? e.message : e)),
      );
    }

    // 5) Espera o texto estabilizar (dois tamanhos iguais seguidos).
    let anterior = -1;
    for (let i = 0; i < 6 && restante() > 800; i++) {
      const atual = await pagina.evaluate<number>(JS_TAMANHO_TEXTO).catch(() => -1);
      if (atual === anterior && atual > 0) break;
      anterior = atual;
      await pausa(350);
    }
    await comPrazo(Promise.allSettled(pendentes), Math.min(restante(), 2500), "respostas JSON pendentes").catch(() => null);

    // 6) Captura.
    const cap = await pagina.evaluate<{ texto: string; tabelas: string[][][]; cartoes: string[]; titulos: string[] }>(JS_CAPTURAR);
    const html = await pagina.content().catch(() => "");
    let screenshot: Buffer | null = null;
    if (opcoes.screenshot) {
      screenshot = await comPrazo(pagina.screenshot({ fullPage: true, type: "png" }), 9000, "a captura de tela demorou demais").catch(
        (e) => {
          avisos.push(`sem captura de tela (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
          return null;
        },
      );
    }
    return {
      url: opcoes.url,
      texto: cap.texto ?? "",
      html,
      tabelas: cap.tabelas ?? [],
      cartoes: cap.cartoes ?? [],
      titulos: cap.titulos ?? [],
      json,
      screenshot,
      duracaoMs: Date.now() - inicio,
      avisos,
      renderizou,
      navegador: sessao.descricao,
    };
  } finally {
    await comPrazo(sessao.fechar(), 5000, "o navegador não fechou a tempo").catch(() => null);
  }
}

/* ------------------------------------------------- da captura para a leitura */
/** Respostas JSON (XHR) do painel → os mesmos blocos do método 1 (API). */
export function dadosSimportDeRespostas(respostas: CapturaNavegador["json"]): DadosSimport | null {
  const d: DadosSimport = { wrf5: [], wrf1: [], ap50: [], ap10: [], pressao: [], boletim: [] };
  let achou = false;
  for (const { url, corpo } of respostas) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (/\/api\/calendar\b/.test(u.pathname) && Array.isArray((corpo as { events?: unknown })?.events)) {
      d.boletim.push(...(corpo as { events: DadosSimport["boletim"] }).events);
      achou = true;
      continue;
    }
    if (!Array.isArray(corpo)) continue;
    const linhas = (corpo as DadosSimport["wrf5"]).filter((l) => typeof l?.date?.sec === "number");
    if (!linhas.length) continue;
    switch (u.searchParams.get("dataGroupId")) {
      case "WRF5":
        d.wrf5 = linhas;
        break;
      case "WRF1":
        d.wrf1 = linhas;
        break;
      case "AP50":
        d.ap50 = linhas;
        d.pressao = linhas; // a página pode pedir a pressão junto com o resto
        break;
      case "AP10":
        d.ap10 = linhas;
        break;
      default:
        continue;
    }
    achou = true;
  }
  return achou ? d : null;
}

/** Completa, com o que veio do JSON, só o que o texto da tela não trouxe. */
function completar(texto: PainelSimport | null, api: PainelSimport | null): PainelSimport | null {
  if (!texto) return api;
  if (!api) return texto;
  const a = texto.agora;
  return {
    ...texto,
    chuva: texto.chuva.length ? texto.chuva : api.chuva,
    vento: texto.vento.length ? texto.vento : api.vento,
    boletim: texto.boletim.length ? texto.boletim : api.boletim,
    agora: {
      temperatura: a.temperatura ?? api.agora.temperatura,
      sensacao: a.sensacao ?? api.agora.sensacao,
      umidade: a.umidade ?? api.agora.umidade,
      ventoNos: a.ventoNos ?? api.agora.ventoNos,
      direcao: a.direcao ?? api.agora.direcao,
      pressao: a.pressao ?? api.agora.pressao,
    },
  };
}

/** Interpreta o que o navegador capturou (JSON da página primeiro, depois o texto renderizado). */
export function lerViaNavegador(cap: CapturaNavegador, agoraMs: number = Date.now()): SaidaMetodo {
  const dados = dadosSimportDeRespostas(cap.json);
  const daApi = dados ? painelDeDadosSimport(dados, agoraMs) : null;
  const doTexto = parsearPainelSimport(cap.texto);
  const painel = completar(doTexto, daApi?.painel ?? null);
  if (!painel || !leituraUtil(painel)) {
    throw new ErroMetodo(
      `o navegador abriu a página, mas ela não mostrou dados do painel: ${cap.texto.length} caracteres de texto, ` +
        `${cap.tabelas.length} tabela(s), ${cap.cartoes.length} cartão(ões), ${cap.json.length} resposta(s) JSON` +
        `${cap.renderizou ? "" : " (o conteúdo não apareceu mesmo após esperar)"}`,
      "vazio",
    );
  }
  const sinais: Sinais | undefined = daApi?.sinais;
  const origem = [doTexto && leituraUtil(doTexto) ? "texto renderizado" : null, daApi ? `${cap.json.length} resposta(s) JSON da página` : null]
    .filter(Boolean)
    .join(" + ");
  return {
    painel,
    sinais,
    atualizadoEm: daApi?.atualizadoEm ?? painel.atualizadoEm ?? null,
    resumo: `${resumirPainel(painel)} · ${origem} · ${cap.tabelas.length} tabela(s)${leituraCompleta(painel) ? "" : " · só o tempo de agora"}`,
  };
}

/* ------------------------------------------------------ localizar o navegador */
const ARGS_BASE = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--hide-scrollbars",
  "--mute-audio",
];

const CAMINHOS_COMUNS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

/** Pacote do Chromium para Lambda/Vercel (o mesmo release da dependência @sparticuz/chromium-min). */
const PACOTE_CHROMIUM_PADRAO = "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

type BrowserLike = {
  newContext(opcoes: Record<string, unknown>): Promise<{
    newPage(): Promise<unknown>;
    close(): Promise<void>;
  }>;
  contexts?(): unknown[];
  close(): Promise<void>;
  version?(): string;
};

const CONTEXTO = {
  viewport: { width: 1366, height: 900 },
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

/** Lista, em ordem, as formas de conseguir um Chromium neste ambiente. */
export function candidatosDeNavegador(
  env: Record<string, string | undefined> = process.env,
  existe: (p: string) => boolean = existsSync,
): { descricao: string; tipo: "ws" | "exe" | "sparticuz" | "playwright"; valor: string }[] {
  const lista: { descricao: string; tipo: "ws" | "exe" | "sparticuz" | "playwright"; valor: string }[] = [];
  const ws = env.APPA_BROWSER_WS?.trim();
  if (ws) lista.push({ descricao: "navegador remoto (APPA_BROWSER_WS)", tipo: "ws", valor: ws });
  const exe =
    env.APPA_CHROMIUM_PATH?.trim() ||
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    env.CHROMIUM_PATH?.trim() ||
    env.CHROME_PATH?.trim();
  if (exe) lista.push({ descricao: `Chromium em ${exe}`, tipo: "exe", valor: exe });
  const serverless = Boolean(env.VERCEL || env.AWS_EXECUTION_ENV || env.AWS_LAMBDA_FUNCTION_NAME || env.APPA_CHROMIUM_PACK_URL);
  if (serverless) {
    lista.push({
      descricao: "Chromium para serverless (@sparticuz/chromium-min)",
      tipo: "sparticuz",
      valor: env.APPA_CHROMIUM_PACK_URL?.trim() || PACOTE_CHROMIUM_PADRAO,
    });
  }
  for (const c of CAMINHOS_COMUNS) if (existe(c)) lista.push({ descricao: `Chromium do sistema (${c})`, tipo: "exe", valor: c });
  lista.push({ descricao: "Chromium instalado pelo Playwright", tipo: "playwright", valor: "" });
  return lista;
}

async function abrirNavegador(restanteMs: number): Promise<Sessao> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new ErroMetodo("o pacote playwright-core não está instalado neste ambiente", "indisponivel");
  }
  const falhas: string[] = [];
  const prazoLancar = Math.min(Math.max(restanteMs - 4000, 6000), 15_000);

  for (const c of candidatosDeNavegador()) {
    try {
      let browser: BrowserLike;
      let descricao = c.descricao;
      if (c.tipo === "ws") {
        browser = (await comPrazo(pw.chromium.connectOverCDP(c.valor), prazoLancar, "tempo esgotado ao conectar")) as unknown as BrowserLike;
      } else if (c.tipo === "exe") {
        browser = (await pw.chromium.launch({ headless: true, executablePath: c.valor, args: ARGS_BASE, timeout: prazoLancar })) as unknown as BrowserLike;
      } else if (c.tipo === "sparticuz") {
        const modulo = (await import("@sparticuz/chromium-min")) as unknown as {
          default: { executablePath(pacote?: string): Promise<string>; args: string[] };
        };
        const exe = await comPrazo(modulo.default.executablePath(c.valor), prazoLancar, "tempo esgotado ao preparar o Chromium");
        browser = (await pw.chromium.launch({ headless: true, executablePath: exe, args: modulo.default.args, timeout: prazoLancar })) as unknown as BrowserLike;
      } else {
        const exe = pw.chromium.executablePath();
        if (!exe || !existsSync(exe)) throw new Error("não instalado (npx playwright install chromium)");
        browser = (await pw.chromium.launch({ headless: true, args: ARGS_BASE, timeout: prazoLancar })) as unknown as BrowserLike;
      }
      const contexto = await browser.newContext(CONTEXTO);
      const pagina = (await contexto.newPage()) as unknown as PaginaLike;
      try {
        descricao = `${c.descricao}${browser.version ? ` · Chromium ${browser.version()}` : ""}`;
      } catch {
        /* versão indisponível */
      }
      return {
        pagina,
        descricao,
        fechar: async () => {
          await contexto.close().catch(() => null);
          await browser.close().catch(() => null);
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      falhas.push(`${c.descricao}: ${msg.slice(0, 140)}`);
    }
  }
  throw new ErroMetodo(
    `nenhum navegador disponível — configure APPA_CHROMIUM_PATH ou APPA_BROWSER_WS (${falhas.join(" · ")})`,
    "indisponivel",
  );
}

/** Para os testes de integração: o caminho do Chromium que este ambiente consegue usar, ou null. */
export function chromiumLocal(env: Record<string, string | undefined> = process.env): string | null {
  const c = candidatosDeNavegador(env).find((x) => x.tipo === "exe");
  return c?.valor ?? null;
}

/** Resolve um arquivo dentro de node_modules a partir da raiz do projeto (funciona com o bundler). */
export const resolverDoProjeto = (id: string) => createRequire(join(process.cwd(), "package.json")).resolve(id);
