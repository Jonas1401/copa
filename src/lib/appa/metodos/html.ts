import { resumirPainel } from "../analise";
import { leituraCompleta, leituraUtil, parsearPainelSimport } from "../painel";
import { htmlParaTexto } from "../texto";
import { ErroMetodo, type PainelSimport, type SaidaMetodo } from "../tipos";
import { definirTokenDescoberto, lerViaApi, tokenEmUso } from "./api";

/**
 * MÉTODO 2 — HTTP + HTML, direto pelo servidor.
 *
 * Baixa a página oficial do painel (sem passar por terceiros) e extrai dela o
 * texto, as tabelas e os dados meteorológicos. Se a página for uma casca que
 * se monta por JavaScript (o caso do painel da APPA), ainda procura:
 *   - JSON incorporado no HTML (`__NEXT_DATA__`, `application/json`, `window.X = {…}`);
 *   - o token público que o site entrega aos scripts: se o da Simport mudou,
 *     o método descobre o novo e lê a API com ele (a leitura sai como "api").
 */

const CABECALHOS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.5",
};

const LIMITE_BUNDLE = 3_000_000;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Baixa um texto (HTML/JS/JSON) com timeout e uma repetição para erro de rede/5xx. */
async function baixar(url: string, timeoutMs: number): Promise<{ status: number; tipo: string; corpo: string }> {
  let ultimo = "sem resposta";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: CABECALHOS,
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((r.status >= 500 || r.status === 429) && tentativa === 0) {
        ultimo = `HTTP ${r.status}`;
        await pausa(500);
        continue;
      }
      const corpo = (await r.text()).slice(0, LIMITE_BUNDLE);
      return { status: r.status, tipo: r.headers.get("content-type") ?? "", corpo };
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new ErroMetodo(`a página não respondeu em ${Math.round(timeoutMs / 1000)} s`);
      }
      ultimo = e instanceof Error ? e.message : String(e);
      if (tentativa === 0) await pausa(500);
    }
  }
  throw new ErroMetodo(`não foi possível baixar a página (${ultimo})`);
}

/* ------------------------------------------------------- JSON incorporado */
/** Objetos JSON que a página já traz dentro do HTML. */
export function extrairJsonsEmbutidos(html: string): unknown[] {
  const achados: unknown[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const conteudo = m[2].trim();
    if (!conteudo || conteudo.length > 2_000_000) continue;
    if (/type=["']?application\/(?:ld\+)?json/i.test(attrs) || /id=["']?__NEXT_DATA__/i.test(attrs)) {
      try {
        achados.push(JSON.parse(conteudo));
      } catch {
        /* JSON inválido: ignora */
      }
      continue;
    }
    // window.__ESTADO__ = {...};  ·  var dados = [...];
    const atrib = conteudo.match(/^(?:window\.[\w$]+|var\s+[\w$]+|const\s+[\w$]+|let\s+[\w$]+)\s*=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/);
    if (atrib) {
      try {
        achados.push(JSON.parse(atrib[1]));
      } catch {
        /* não era JSON puro */
      }
    }
  }
  return achados.slice(0, 12);
}

const CHAVES_JSON: Record<"temperatura" | "sensacao" | "umidade" | "pressao", RegExp> = {
  temperatura: /^(?:temp(?:eratura)?|temperature|tempC|temp_c)(?:Average|Avg|Atual|Current)?$/i,
  sensacao: /^(?:sensacao(?:Termica)?|thermalSensation|feelsLike|feels_like|apparentTemperature)(?:Average)?$/i,
  umidade: /^(?:umidade|humidity|relativeHumidity)(?:Average)?$/i,
  pressao: /^(?:pressao|pressure|pressureMsl|pressure_msl|surface_pressure)(?:Average)?$/i,
};

/**
 * Procura, num JSON qualquer, os campos do tempo de agora (temperatura,
 * umidade, pressão…). Conservador: só vale com 2 ou mais campos plausíveis.
 */
export function extrairAgoraDeJson(valor: unknown): Partial<PainelSimport["agora"]> | null {
  const achado: Partial<Record<keyof typeof CHAVES_JSON, number>> = {};
  let visitados = 0;
  const visitar = (v: unknown, nivel: number) => {
    if (visitados++ > 5000 || nivel > 7 || !v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "object") {
        visitar(x, nivel + 1);
        continue;
      }
      const n = typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(",", ".")) : Number.NaN;
      if (!Number.isFinite(n)) continue;
      for (const campo of Object.keys(CHAVES_JSON) as (keyof typeof CHAVES_JSON)[]) {
        if (achado[campo] == null && CHAVES_JSON[campo].test(k)) achado[campo] = n;
      }
    }
  };
  visitar(valor, 0);
  const ok =
    (achado.temperatura != null && achado.temperatura > -15 && achado.temperatura < 55 ? 1 : 0) +
    (achado.umidade != null && achado.umidade >= 0 && achado.umidade <= 100 ? 1 : 0) +
    (achado.pressao != null && achado.pressao > 850 && achado.pressao < 1100 ? 1 : 0);
  if (ok < 2) return null;
  return {
    temperatura: achado.temperatura ?? null,
    sensacao: achado.sensacao ?? null,
    umidade: achado.umidade ?? null,
    pressao: achado.pressao ?? null,
  };
}

/* ------------------------------------------------- descoberta nos scripts */
const RE_TOKEN_PUBLICO = /\b[0-9A-F]{4}(?:-[0-9A-F]{4}){3}\b/g;
const RE_AUTH_TOKEN = /AUTH-TOKEN["'\s:,=]+["']?([A-Za-z0-9_-]{8,64})/g;

/** Tokens que o código do site manda para a API (exceto o que já usamos). */
export function descobrirTokens(js: string, atual: string): string[] {
  const achados = new Set<string>();
  for (const m of js.matchAll(RE_AUTH_TOKEN)) achados.add(m[1]);
  for (const m of js.matchAll(RE_TOKEN_PUBLICO)) achados.add(m[0]);
  achados.delete(atual);
  return [...achados].slice(0, 3);
}

/** Endereços dos scripts da página (só do próprio site e da Simport). */
export function enderecosDeScripts(html: string, base: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === new URL(base).origin || /(^|\.)simport\.com\.br$/i.test(u.hostname)) urls.push(u.toString());
    } catch {
      /* endereço inválido */
    }
  }
  return [...new Set(urls)].slice(0, 4);
}

/* -------------------------------------------------------------- método */
export async function lerViaHtml(opcoes: { url: string; timeoutMs: number }): Promise<SaidaMetodo> {
  const inicio = Date.now();
  const restante = () => Math.max(1500, opcoes.timeoutMs - (Date.now() - inicio));

  const pagina = await baixar(opcoes.url, Math.min(restante(), 8000));
  if (pagina.status >= 400) {
    throw new ErroMetodo(`a página respondeu HTTP ${pagina.status}`);
  }
  const html = pagina.corpo;
  if (html.trim().length < 20) throw new ErroMetodo("a página respondeu vazia", "vazio");

  // 1) O painel já vem no HTML (página renderizada no servidor)?
  const texto = htmlParaTexto(html);
  const painel = parsearPainelSimport(texto);
  if (painel && leituraCompleta(painel)) {
    return {
      painel,
      atualizadoEm: painel.atualizadoEm ?? null,
      resumo: `${resumirPainel(painel)} · ${texto.length} caracteres de texto no HTML`,
    };
  }

  // 2) JSON incorporado na página.
  let parcial: PainelSimport | null = painel && leituraUtil(painel) ? painel : null;
  for (const json of [...(/json/i.test(pagina.tipo) ? [safeJson(html)] : []), ...extrairJsonsEmbutidos(html)]) {
    const agora = json ? extrairAgoraDeJson(json) : null;
    if (agora) parcial = mesclarAgora(parcial, agora);
  }

  // 3) Página montada por JavaScript: o token que o site usa pode ter mudado.
  const scripts = enderecosDeScripts(html, opcoes.url);
  let tentouToken = 0;
  if (scripts.length && restante() > 3500) {
    for (const src of scripts) {
      if (restante() < 3000) break;
      let js = "";
      try {
        js = (await baixar(src, Math.min(restante(), 5000))).corpo;
      } catch {
        continue;
      }
      for (const token of descobrirTokens(js, tokenEmUso())) {
        if (restante() < 2500) break;
        tentouToken++;
        try {
          const saida = await lerViaApi({ token, timeoutMs: Math.min(restante(), 7000) });
          if (leituraCompleta(saida.painel)) {
            definirTokenDescoberto(token);
            return {
              ...saida,
              metodoEfetivo: "api",
              resumo: `token novo descoberto no site da APPA · ${saida.resumo}`,
            };
          }
        } catch {
          /* este token não serve: tenta o próximo */
        }
      }
    }
  }

  if (parcial) {
    return {
      painel: parcial,
      atualizadoEm: parcial.atualizadoEm ?? null,
      resumo: `${resumirPainel(parcial)} (só o tempo de agora, sem tabelas)`,
    };
  }
  throw new ErroMetodo(
    `a página não traz os dados no HTML: ${html.length} caracteres de HTML, ${texto.length} de texto, ` +
      `${scripts.length} script(s)${tentouToken ? `, ${tentouToken} token(s) testado(s)` : ""} — ` +
      "o conteúdo é montado por JavaScript (veja o método Navegador automático)",
    "vazio",
  );
}

/** Junta o "tempo de agora" achado no JSON ao que já se leu (sem apagar nada). */
function mesclarAgora(base: PainelSimport | null, agora: Partial<PainelSimport["agora"]>): PainelSimport {
  const painel: PainelSimport = base ?? {
    boletim: [], chuva: [], vento: [], mares: [], nascerSol: null, porSol: null,
    agora: { temperatura: null, sensacao: null, umidade: null, ventoNos: null, direcao: null, pressao: null },
  };
  const novo = { ...painel.agora };
  for (const campo of ["temperatura", "sensacao", "umidade", "pressao"] as const) {
    if (novo[campo] == null && agora[campo] != null) novo[campo] = agora[campo] ?? null;
  }
  return { ...painel, agora: novo };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
