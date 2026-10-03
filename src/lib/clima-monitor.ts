import { createHash } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, climaMudancas, configuracao } from "@/db/schema";
import { notificarMensagemChat } from "@/lib/chat-push";
import { composioConfigurado, geminiViaComposio, painelSimportComposio } from "@/lib/composio";
import { GRAVIDADE, obterPrevisao, type Previsao } from "@/lib/tempo";

/**
 * RADAR DA PREVISÃO — monitor constante do tempo via Composio (SÓ servidor).
 *
 * O `/api/cron` (a cada minuto) chama `verificarMudancasPrevisao()`. O radar
 * lê a previsão do porto de novo a cada `CLIMA_MONITOR_MIN` minutos (padrão 5)
 * por dois caminhos ao mesmo tempo:
 *
 *   1. a API estruturada do SIMPORT® — Dashboard Meteoceanográfico da APPA
 *      (modelo WRF hora a hora, estação do porto, boletim e Open-Meteo), a
 *      mesma que alimenta a tela "Tempo";
 *   2. o PAINEL PÚBLICO (https://weather-appa.app.simport.com.br/) lido PELO
 *      COMPOSIO a cada `CLIMA_MONITOR_PAINEL_MIN` minutos (padrão 30): boletim
 *      do dia, tabelas de chuva e vento das próximas 24 h e tábua de marés.
 *
 * Cada leitura vira um "instantâneo" (números + textos normalizados) que é
 * comparado com o instantâneo do último aviso. Achou diferença acima do
 * limite da sensibilidade escolhida, o radar:
 *
 *   - posta UMA mensagem no chat dos motoristas como "📡 Radar da Previsão"
 *     (`motorista_id = 0` = sistema), escrita pela IA (Gemini pelo Composio)
 *     com os números reais — se a IA falhar, vale o texto pronto das regras;
 *   - dispara Web Push para todos os aparelhos: a notificação chega MESMO COM
 *     O APLICATIVO FECHADO (quem exibe é o Service Worker) e, ao tocar, abre o
 *     chat; em mudança grave (chuva forte, rajada ≥ 40 km/h ou boletim da APPA
 *     com tempo ruim) o aviso fica na tela até o motorista tocar.
 *
 * Antispam (o radar fala só quando vale a pena):
 *   - 1ª leitura apenas registra o instantâneo, sem avisar nada antigo;
 *   - a comparação é sempre contra o ÚLTIMO AVISO, então uma mudança lenta
 *     (ex.: a chuva crescendo aos poucos) é avisada uma única vez;
 *   - cada mudança tem assinatura única por bloco de 3 h (`clima_mudancas`):
 *     o mesmo "de 20% para 75%" não repete na mesma janela;
 *   - intervalo mínimo entre avisos e teto por hora (`CLIMA_MONITOR_*`);
 *   - se o alerta/boletim do clima acabou de falar no mesmo minuto, o radar
 *     avança a referência calado (`registrarSomente`);
 *   - quem silenciou o chat não recebe (mesmo caminho dos outros agentes).
 *
 * Nada aqui altera a fila, os pontos ou os avisos NA VEZ/SAIU.
 */

/** Nome do agente no chat (aparece como remetente e título da notificação). */
export const NOME_RADAR = "📡 Radar da Previsão";
/** 0 = mensagem do sistema/agente (igual aos avisos de clima e navios). */
const MOTORISTA_SISTEMA = 0;

const CHAVE_INSTANTANEO = "clima_monitor_instantaneo";
const CHAVE_ULTIMA = "clima_monitor_ultima";
const CHAVE_PAINEL = "clima_monitor_painel";
const CHAVE_SEMEADO = "clima_monitor_semeado";

/* -------------------------------------------------------- configuração */
export type Sensibilidade = "baixa" | "media" | "alta";

/** Quanto cada número precisa mudar para virar aviso (por sensibilidade). */
export const LIMIARES: Record<
  Sensibilidade,
  {
    chuvaProb: number; // pontos percentuais
    chuvaMm: number; // mm
    rajada: number; // km/h
    vento: number; // km/h
    ventoNos: number; // nós (painel da APPA)
    temp: number; // °C (previsão)
    tempAgora: number; // °C (medição no porto)
    gravidade: number; // níveis de condição (0 sol … 7 temporal)
  }
> = {
  baixa: { chuvaProb: 30, chuvaMm: 3, rajada: 15, vento: 15, ventoNos: 8, temp: 5, tempAgora: 6, gravidade: 3 },
  media: { chuvaProb: 20, chuvaMm: 1, rajada: 10, vento: 10, ventoNos: 5, temp: 3, tempAgora: 4, gravidade: 2 },
  alta: { chuvaProb: 10, chuvaMm: 0.5, rajada: 6, vento: 6, ventoNos: 3, temp: 2, tempAgora: 2, gravidade: 1 },
};

export type ConfigRadar = {
  ativo: boolean;
  sensibilidade: Sensibilidade;
  intervaloMs: number;
  painelMs: number;
  avisoMinMs: number;
  maxPorHora: number;
};

const numero = (v: unknown, padrao: number) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

const DESLIGADO = new Set(["0", "off", "false", "nao", "não", "desligado"]);

/** Configuração do radar (variáveis de ambiente, todas opcionais). */
export function configRadar(ambiente: Record<string, string | undefined> = process.env): ConfigRadar {
  const sens = String(ambiente.CLIMA_MONITOR_SENSIBILIDADE ?? "").trim().toLowerCase();
  return {
    ativo: !DESLIGADO.has(String(ambiente.CLIMA_MONITOR_ATIVO ?? "1").trim().toLowerCase()),
    sensibilidade: sens === "baixa" || sens === "alta" ? sens : "media",
    intervaloMs: numero(ambiente.CLIMA_MONITOR_MIN, 5) * 60_000,
    painelMs: numero(ambiente.CLIMA_MONITOR_PAINEL_MIN, 30) * 60_000,
    avisoMinMs: numero(ambiente.CLIMA_MONITOR_AVISO_MIN, 20) * 60_000,
    maxPorHora: numero(ambiente.CLIMA_MONITOR_MAX_HORA, 3),
  };
}

/* ------------------------------------------------------------- tipos */
export type PainelSimport = {
  boletim: { dia: string; texto: string }[];
  chuva: { hora: string; mm: number; prob: number }[];
  vento: { hora: string; nos: number; direcao: string }[];
  mares: { hora: string; altura: number; tipo: "alta" | "baixa" }[];
  nascerSol: string | null;
  porSol: string | null;
  agora: {
    temperatura: number | null;
    sensacao: number | null;
    umidade: number | null;
    ventoNos: number | null;
    direcao: string | null;
    pressao: number | null;
  };
};

/** Fotografia comparável da previsão (só o que pode mudar e interessa). */
export type InstantaneoClima = {
  em: number;
  fontes: { simport: boolean; estacao: boolean; openMeteo: boolean; composio: boolean; painel: boolean };
  /** Modelo WRF da APPA (próximas 24 h). */
  api: {
    chuvaProb6h: number;
    chuvaProb24h: number;
    chuvaMm24h: number;
    rajadaMax: number;
    ventoMax: number;
    gravidade: number;
    condicao: string;
  } | null;
  hoje: { max: number; min: number; chance: number; mm: number } | null;
  amanha: { max: number; min: number; chance: number; mm: number } | null;
  /** Boletim meteorológico da APPA por dia (fonte: API ou painel). */
  boletim: { fonte: "api" | "painel"; ruim: boolean; porDia: Record<string, string> } | null;
  /** Painel público lido pelo Composio. */
  painel: { chuvaProb24h: number; chuvaMm24h: number; ventoNosMax: number; mares: string; sol: string } | null;
  /** Medição no porto (estação da APPA ou OpenWeather pelo Composio). */
  agora: {
    fonte: string;
    temperatura: number;
    vento: number;
    rajada: number;
    umidade: number;
    descricao: string;
  } | null;
};

export type TipoMudanca =
  | "chuva"
  | "vento"
  | "temperatura"
  | "condicao"
  | "boletim"
  | "mare"
  | "sol"
  | "medicao";

export type Mudanca = {
  tipo: TipoMudanca;
  /** De onde veio o dado: api = WRF/estação · painel = página lida pelo Composio. */
  origem: "api" | "painel" | "boletim" | "agora";
  rotulo: string;
  antes: string;
  agora: string;
  /** Frase pronta em português (usada no chat quando a IA não responde). */
  frase: string;
  grave: boolean;
  /** Identidade da mudança (única por dia em `clima_mudancas`). */
  assinatura: string;
  /** Ordem de importância no aviso (menor = mais importante). */
  peso: number;
};

export type ResultadoRadar = {
  rodou: boolean;
  postou: boolean;
  motivo: string;
  mudancas: string[];
};

/* ------------------------------------------- leitura do painel (Composio) */
const RE_HORA = /^\d{1,2}:\d{2}$/;
const RE_DIRECAO =
  /^(N|NNE|NNO|NE|ENE|E|ESE|SE|SSE|S|SSO|SSW|SO|SW|WSW|OSO|OSW|W|O|ONO|WNW|NW|NNW|L)$/i;
const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Converte o texto (markdown) que o Composio devolve do painel da Simport em
 * dados comparáveis. O painel separa cada célula em uma linha e às vezes cola
 * tudo ("02:001.2mAlta"), então a leitura é por seção e tolerante a layout.
 */
export function parsearPainelSimport(bruto: string): PainelSimport | null {
  if (!bruto || bruto.trim().length < 60) return null;
  const linhas = bruto
    .split(/\r?\n/)
    .map((l) => l.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (linhas.length < 5) return null;

  const acha = (re: RegExp) => linhas.findIndex((l) => re.test(l));
  const fimDaSecao = (inicio: number, ...marcos: number[]) => {
    const proximos = marcos.filter((m) => m > inicio);
    return proximos.length ? Math.min(...proximos) : linhas.length;
  };

  const iChuva = acha(/previs[ãa]o de chuvas/i);
  const iVento = acha(/previs[ãa]o de ventos/i);
  const iMares = acha(/previs[ãa]o de mar[ée]s/i);
  const iLua = acha(/fases da lua/i);
  const iMapa = acha(/mapa de localiza/i);
  const iDiaVento = acha(/dire[çc][ãa]o do vento durante o dia/i);

  /* ------------------------------------------ tabela de chuva (24 h) */
  const chuva: PainelSimport["chuva"] = [];
  if (iChuva >= 0) {
    const ate = fimDaSecao(iChuva, iVento, iMares, iLua, iMapa);
    for (let i = iChuva + 1; i < ate; i++) {
      if (!RE_HORA.test(linhas[i])) continue;
      let mm = Number.NaN;
      let prob = Number.NaN;
      for (let j = i + 1; j < Math.min(i + 5, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const m = linhas[j].match(/([\d.,]+)\s*mm/i);
        if (m && Number.isNaN(mm)) mm = num(m[1]);
        const p = linhas[j].match(/(\d+)\s*%/);
        if (p && Number.isNaN(prob)) prob = Number(p[1]);
      }
      if (Number.isFinite(mm) || Number.isFinite(prob)) {
        chuva.push({ hora: linhas[i], mm: Number.isFinite(mm) ? mm : 0, prob: Number.isFinite(prob) ? prob : 0 });
      }
    }
  }

  /* ------------------------------------------ tabela de vento (24 h) */
  const vento: PainelSimport["vento"] = [];
  if (iVento >= 0) {
    const ate = fimDaSecao(iVento, iDiaVento, iMares, iLua, iMapa);
    for (let i = iVento + 1; i < ate; i++) {
      if (!RE_HORA.test(linhas[i])) continue;
      let nos = Number.NaN;
      let direcao = "";
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const n = linhas[j].match(/([\d.,]+)\s*n[óo]s/i);
        if (n && Number.isNaN(nos)) nos = num(n[1]);
        const d = linhas[j].trim().match(RE_DIRECAO);
        if (d && !direcao) direcao = d[1].toUpperCase();
      }
      if (Number.isFinite(nos)) vento.push({ hora: linhas[i], nos, direcao });
    }
  }

  /* ------------------------------------------------------ marés */
  const mares: PainelSimport["mares"] = [];
  if (iMares >= 0) {
    const ate = fimDaSecao(iMares, iLua, iMapa);
    for (let i = iMares + 1; i < ate; i++) {
      // Formato colado do painel: "02:001.2mAlta".
      const cola = linhas[i].match(/(\d{1,2}:\d{2})\s*([\d.,]+)\s*m\s*(alta|baixa)/i);
      if (cola) {
        mares.push({
          hora: cola[1],
          altura: num(cola[2]),
          tipo: cola[3].toLowerCase() === "alta" ? "alta" : "baixa",
        });
        continue;
      }
      if (!RE_HORA.test(linhas[i])) continue;
      let altura = Number.NaN;
      let tipo = "";
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const a = linhas[j].match(/([\d.,]+)\s*m\b/i);
        if (a && Number.isNaN(altura)) altura = num(a[1]);
        const t = linhas[j].match(/\b(alta|baixa)\b/i);
        if (t && !tipo) tipo = t[1].toLowerCase();
      }
      if (Number.isFinite(altura) && tipo) {
        mares.push({ hora: linhas[i], altura, tipo: tipo === "alta" ? "alta" : "baixa" });
      }
    }
  }

  /* ------------------------------------- nascer/pôr do sol e boletim */
  const horaPerto = (re: RegExp) => {
    const i = acha(re);
    if (i < 0) return null;
    const naLinha = linhas[i].match(/(\d{1,2}:\d{2})/);
    if (naLinha) return naLinha[1];
    for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
      if (RE_HORA.test(linhas[j])) return linhas[j];
    }
    return null;
  };
  const nascerSol = horaPerto(/nascer do sol/i);
  const porSol = horaPerto(/p[ôo]r do sol/i);

  const boletim: PainelSimport["boletim"] = [];
  const reBoletim =
    /^(seg|ter|qua|qui|sex|s[áa]b|sab|dom)[a-zçã]*\.?\s*\((\d{1,2}\/\d{1,2})\)\s*:?\s*(.*)$/i;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(reBoletim);
    if (!m) continue;
    const texto = (m[3] ?? "").trim() || (linhas[i + 1] ?? "").trim();
    if (texto.length > 15) boletim.push({ dia: `${m[2]}`, texto });
  }

  /* --------------------------------------- medições do topo do painel */
  const valorPerto = (rotulo: RegExp, extrai: RegExp): number | null => {
    const i = acha(rotulo);
    if (i < 0) return null;
    for (const c of [linhas[i], linhas[i - 1], linhas[i + 1], linhas[i - 2], linhas[i + 2]]) {
      const m = c?.match(extrai);
      if (m) {
        const n = num(m[1]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  const linhaGraus = linhas.slice(0, 20).find((l) => /^-?[\d.,]+\s*°\s*C$/.test(l));
  const temperatura = linhaGraus ? num(linhaGraus) : null;
  // Vento atual: o primeiro "nós" antes da tabela de previsão de ventos.
  const iVentoAtual = linhas.findIndex(
    (l, i) => (iVento < 0 || i < iVento) && /[\d.,]+\s*n[óo]s/i.test(l),
  );
  const ventoAtual =
    iVentoAtual >= 0 ? num((linhas[iVentoAtual].match(/([\d.,]+)\s*n[óo]s/i) ?? [])[1] ?? "") : null;
  const direcaoAtual =
    iVentoAtual >= 0
      ? (linhas
          .slice(iVentoAtual + 1, iVentoAtual + 3)
          .find((l) => RE_DIRECAO.test(l.trim())) ?? null)
      : null;

  return {
    boletim,
    chuva,
    vento,
    mares,
    nascerSol,
    porSol,
    agora: {
      temperatura: Number.isFinite(temperatura ?? Number.NaN) ? temperatura : null,
      sensacao: valorPerto(/sensa[çc][ãa]o t[ée]rmica/i, /(-?[\d.,]+)\s*°?\s*C/i),
      umidade: valorPerto(/^umidade\b|umidade\s*:/i, /([\d.,]+)\s*%/),
      ventoNos: Number.isFinite(ventoAtual ?? Number.NaN) ? ventoAtual : null,
      direcao: direcaoAtual ? direcaoAtual.toUpperCase() : null,
      pressao: valorPerto(/^press[ãa]o\b|press[ãa]o\s*:/i, /([\d.,]+)/),
    },
  };
}

/* ------------------------------------------------------- instantâneo */
const FUSO = "America/Sao_Paulo";

/** Texto comparável: sem acento de formatação, espaços ou pontuação final. */
export function normalizarTexto(s: string) {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?…–—-]+$/g, "")
    .trim()
    .toLowerCase();
}

const curtas8 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

function resumoHoras(p: Previsao, quantas: number) {
  const agoraMs = Date.now();
  const horas = p.horas.filter((h) => h.ts * 1000 >= agoraMs - 30 * 60_000).slice(0, quantas);
  if (!horas.length) return null;
  const pior = horas.reduce((a, h) => (GRAVIDADE[h.icone] > GRAVIDADE[a.icone] ? h : a), horas[0]);
  return {
    chanceMax: Math.max(...horas.map((h) => h.chanceChuva)),
    mm: r1(horas.reduce((s, h) => s + h.chuvaMm, 0)),
    rajadaMax: Math.max(...horas.map((h) => h.rajadaKmh)),
    ventoMax: Math.max(...horas.map((h) => h.ventoKmh)),
    gravidade: GRAVIDADE[pior.icone],
    condicao: pior.descricao,
  };
}

/** Monta a fotografia comparável a partir das duas fontes do radar. */
export function montarInstantaneo(
  p: Previsao | null,
  painel: PainelSimport | null,
  em: number = Date.now(),
): InstantaneoClima {
  const tem24 = p ? resumoHoras(p, 24) : null;
  const tem6 = p ? resumoHoras(p, 6) : null;
  const hoje = p?.dias[0] ?? null;
  const amanha = p?.dias[1] ?? null;

  const porDiaApi: Record<string, string> = {};
  for (const b of p?.boletim ?? []) if (b.texto) porDiaApi[b.data] = normalizarTexto(b.texto);
  const porDiaPainel: Record<string, string> = {};
  for (const b of painel?.boletim ?? []) if (b.texto) porDiaPainel[b.dia] = normalizarTexto(b.texto);
  const temApi = Object.keys(porDiaApi).length > 0;
  const temPainel = Object.keys(porDiaPainel).length > 0;

  const agoraPainel = painel?.agora ?? null;
  const agora = p
    ? {
        fonte: p.agora.fonte,
        temperatura: p.agora.temperatura,
        vento: p.agora.ventoKmh,
        rajada: p.agora.rajadaKmh,
        umidade: p.agora.umidade,
        descricao: p.agora.descricao,
      }
    : agoraPainel?.temperatura != null
      ? {
          fonte: "painel",
          temperatura: agoraPainel.temperatura,
          vento: Math.round((agoraPainel.ventoNos ?? 0) * 1.852),
          rajada: Math.round((agoraPainel.ventoNos ?? 0) * 1.852),
          umidade: agoraPainel.umidade ?? 0,
          descricao: "",
        }
      : null;

  return {
    em,
    fontes: {
      simport: Boolean(p?.fontes.simport),
      estacao: Boolean(p?.fontes.estacao),
      openMeteo: Boolean(p?.fontes.openMeteo),
      composio: Boolean(p?.fontes.composio),
      painel: Boolean(painel && (painel.chuva.length || painel.vento.length || temPainel)),
    },
    api:
      tem24 && tem6 && p
        ? {
            chuvaProb6h: tem6.chanceMax,
            chuvaProb24h: tem24.chanceMax,
            chuvaMm24h: tem24.mm,
            rajadaMax: tem24.rajadaMax,
            ventoMax: tem24.ventoMax,
            gravidade: tem24.gravidade,
            condicao: tem24.condicao,
          }
        : null,
    hoje: hoje ? { max: hoje.max, min: hoje.min, chance: hoje.chanceChuva, mm: hoje.chuvaMm } : null,
    amanha: amanha ? { max: amanha.max, min: amanha.min, chance: amanha.chanceChuva, mm: amanha.chuvaMm } : null,
    boletim: temApi
      ? { fonte: "api", ruim: Boolean(p?.boletim.some((b) => b.tempoRuim)), porDia: porDiaApi }
      : temPainel
        ? { fonte: "painel", ruim: false, porDia: porDiaPainel }
        : null,
    painel:
      painel && (painel.chuva.length || painel.vento.length || painel.mares.length)
        ? {
            chuvaProb24h: Math.max(0, ...painel.chuva.map((c) => c.prob)),
            chuvaMm24h: r1(painel.chuva.reduce((s, c) => s + c.mm, 0)),
            ventoNosMax: r1(Math.max(0, ...painel.vento.map((v) => v.nos))),
            mares: painel.mares
              .map((m) => `${m.hora} ${r1(m.altura).toString().replace(".", ",")}m ${m.tipo}`)
              .join("; "),
            sol: [painel.nascerSol, painel.porSol].filter(Boolean).join("/") || "-",
          }
        : null,
    agora,
  };
}

/* ------------------------------------------------------ comparação */
const fmtPct = (n: number) => `${Math.round(n)}%`;
const fmtKm = (n: number) => `${Math.round(n)} km/h`;
const fmtGrau = (n: number) => `${Math.round(n)}°C`;
const fmtMm = (n: number) => `${r1(n).toString().replace(".", ",")} mm`;
const fmtNos = (n: number) => `${r1(n).toString().replace(".", ",")} nós`;

/**
 * Compara dois instantâneos e devolve as mudanças que passaram do limite da
 * sensibilidade. Só compara o que existe nos DOIS lados (fonte fora do ar não
 * vira mudança) e nunca repete o mesmo fato por duas fontes: quando a API
 * estruturada já acusou o tipo (ex.: chuva), o painel não repete.
 */
export function detectarMudancas(
  antes: InstantaneoClima,
  agora: InstantaneoClima,
  sensibilidade: Sensibilidade = "media",
): Mudanca[] {
  const l = LIMIARES[sensibilidade] ?? LIMIARES.media;
  const achadas: Mudanca[] = [];

  function compararNumero(opcoes: {
    tipo: TipoMudanca;
    origem: Mudanca["origem"];
    chave: string;
    rotulo: string;
    antes: number | null | undefined;
    agora: number | null | undefined;
    delta: number;
    formato: (n: number) => string;
    peso: number;
    grave?: (antes: number, agora: number) => boolean;
  }) {
    const a = opcoes.antes;
    const b = opcoes.agora;
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return;
    const dif = b - a;
    if (Math.abs(dif) < opcoes.delta) return;
    achadas.push({
      tipo: opcoes.tipo,
      origem: opcoes.origem,
      rotulo: opcoes.rotulo,
      antes: opcoes.formato(a),
      agora: opcoes.formato(b),
      frase: `${opcoes.rotulo} ${dif > 0 ? "subiu" : "caiu"} de ${opcoes.formato(a)} para ${opcoes.formato(b)}`,
      grave: Boolean(opcoes.grave?.(a, b)),
      assinatura: `${opcoes.chave}:${r1(a)}>${r1(b)}`,
      peso: opcoes.peso,
    });
  }

  /* ------------------------------------- previsão WRF (API estruturada) */
  if (antes.api && agora.api) {
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb6h", rotulo: "Chance de chuva nas próximas 6 h",
      antes: antes.api.chuvaProb6h, agora: agora.api.chuvaProb6h, delta: l.chuvaProb, formato: fmtPct, peso: 10,
      grave: (a, b) => b >= 60 && a < 60,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb24h", rotulo: "Chance de chuva nas próximas 24 h",
      antes: antes.api.chuvaProb24h, agora: agora.api.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct, peso: 12,
      grave: (a, b) => b >= 70 && a < 70,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaMm24h", rotulo: "Volume de chuva previsto em 24 h",
      antes: antes.api.chuvaMm24h, agora: agora.api.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 14,
      grave: (a, b) => b >= 5 && a < 5,
    });
    compararNumero({
      tipo: "vento", origem: "api", chave: "rajadaMax", rotulo: "Rajada máxima prevista em 24 h",
      antes: antes.api.rajadaMax, agora: agora.api.rajadaMax, delta: l.rajada, formato: fmtKm, peso: 20,
      grave: (a, b) => b >= 40 && a < 40,
    });
    compararNumero({
      tipo: "vento", origem: "api", chave: "ventoMax", rotulo: "Vento máximo previsto em 24 h",
      antes: antes.api.ventoMax, agora: agora.api.ventoMax, delta: l.vento, formato: fmtKm, peso: 22,
      grave: (a, b) => b >= 30 && a < 30,
    });
    // Condição do tempo: o número é a gravidade (0 sol … 7 temporal), mas o
    // que o motorista lê é o nome ("Parcialmente nublado" → "Chuva forte").
    const gA = antes.api.gravidade;
    const gB = agora.api.gravidade;
    if (Math.abs(gB - gA) >= l.gravidade) {
      achadas.push({
        tipo: "condicao",
        origem: "api",
        rotulo: "Condição do tempo em 24 h",
        antes: antes.api.condicao,
        agora: agora.api.condicao,
        frase: `a condição do tempo em 24 h mudou de ${antes.api.condicao.toLowerCase()} para ${agora.api.condicao.toLowerCase()}`,
        grave: gB >= GRAVIDADE.chuva && gA < GRAVIDADE.chuva,
        assinatura: `condicao:${gA}>${gB}`,
        peso: 30,
      });
    }
  }

  /* -------------------------------------------------- hoje e amanhã */
  for (const [chave, rotulo, a, b] of [
    ["hoje", "Hoje", antes.hoje, agora.hoje],
    ["amanha", "Amanhã", antes.amanha, agora.amanha],
  ] as const) {
    if (!a || !b) continue;
    compararNumero({
      tipo: "temperatura", origem: "api", chave: `${chave}.max`, rotulo: `Máxima de ${rotulo.toLowerCase()}`,
      antes: a.max, agora: b.max, delta: l.temp, formato: fmtGrau, peso: chave === "hoje" ? 40 : 50,
    });
    compararNumero({
      tipo: "temperatura", origem: "api", chave: `${chave}.min`, rotulo: `Mínima de ${rotulo.toLowerCase()}`,
      antes: a.min, agora: b.min, delta: l.temp, formato: fmtGrau, peso: chave === "hoje" ? 42 : 52,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: `${chave}.chance`, rotulo: `Chance de chuva ${chave === "hoje" ? "hoje" : "amanhã"}`,
      antes: a.chance, agora: b.chance, delta: l.chuvaProb, formato: fmtPct, peso: chave === "hoje" ? 44 : 54,
      grave: (x, y) => y >= 70 && x < 70,
    });
  }

  /* ---------------------------------------------- boletim da APPA */
  if (antes.boletim && agora.boletim && antes.boletim.fonte === agora.boletim.fonte) {
    for (const [dia, texto] of Object.entries(agora.boletim.porDia)) {
      const anterior = antes.boletim.porDia[dia];
      if (anterior === texto) continue;
      const novo = anterior == null;
      achadas.push({
        tipo: "boletim",
        origem: "boletim",
        rotulo: `Boletim da APPA (${dia})`,
        antes: novo ? "—" : anterior.slice(0, 120),
        agora: texto.slice(0, 200),
        frase: novo
          ? `boletim da APPA publicado para ${dia}: ${texto.slice(0, 180)}`
          : `boletim da APPA revisado para ${dia}: ${texto.slice(0, 180)}`,
        grave: agora.boletim.ruim,
        assinatura: `boletim:${dia}:${curtas8(texto)}`,
        peso: novo ? 5 : 6,
      });
    }
    if (antes.boletim.ruim !== agora.boletim.ruim) {
      achadas.push({
        tipo: "boletim",
        origem: "boletim",
        rotulo: "Alerta de tempo ruim da APPA",
        antes: antes.boletim.ruim ? "ativo" : "desligado",
        agora: agora.boletim.ruim ? "ativo" : "desligado",
        frase: agora.boletim.ruim
          ? "a APPA marcou tempo ruim no boletim do porto"
          : "a APPA retirou o aviso de tempo ruim do boletim",
        grave: agora.boletim.ruim,
        assinatura: `boletimRuim:${agora.boletim.ruim ? "1" : "0"}`,
        peso: 4,
      });
    }
  }

  /* ----------------------------------- painel público lido pelo Composio */
  if (antes.painel && agora.painel) {
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaProb", rotulo: "Chuva no painel da APPA (24 h)",
      antes: antes.painel.chuvaProb24h, agora: agora.painel.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct,
      peso: 60, grave: (a, b) => b >= 70 && a < 70,
    });
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaMm", rotulo: "Volume de chuva no painel da APPA",
      antes: antes.painel.chuvaMm24h, agora: agora.painel.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 61,
    });
    compararNumero({
      tipo: "vento", origem: "painel", chave: "painel.vento", rotulo: "Vento no painel da APPA (24 h)",
      antes: antes.painel.ventoNosMax, agora: agora.painel.ventoNosMax, delta: l.ventoNos, formato: fmtNos,
      peso: 62, grave: (a, b) => b >= 25 && a < 25,
    });
    if (antes.painel.mares && agora.painel.mares && antes.painel.mares !== agora.painel.mares) {
      achadas.push({
        tipo: "mare",
        origem: "painel",
        rotulo: "Tábua de marés da APPA",
        antes: antes.painel.mares.slice(0, 120),
        agora: agora.painel.mares.slice(0, 160),
        frase: `a tábua de marés do painel da APPA mudou (${agora.painel.mares.slice(0, 140)})`,
        grave: false,
        assinatura: `mares:${curtas8(agora.painel.mares)}`,
        peso: 70,
      });
    }
    if (antes.painel.sol && agora.painel.sol && antes.painel.sol !== agora.painel.sol) {
      achadas.push({
        tipo: "sol",
        origem: "painel",
        rotulo: "Horários do sol",
        antes: antes.painel.sol,
        agora: agora.painel.sol,
        frase: `os horários do sol mudaram (${antes.painel.sol} → ${agora.painel.sol})`,
        grave: false,
        assinatura: `sol:${agora.painel.sol.replace(/[^0-9]/g, "")}`,
        peso: 90,
      });
    }
  }

  /* ---------------------------------------------- medição no porto */
  if (antes.agora && agora.agora && antes.agora.fonte === agora.agora.fonte) {
    compararNumero({
      tipo: "medicao", origem: "agora", chave: "agora.temp", rotulo: "Temperatura medida no porto",
      antes: antes.agora.temperatura, agora: agora.agora.temperatura, delta: l.tempAgora, formato: fmtGrau, peso: 80,
    });
    compararNumero({
      tipo: "medicao", origem: "agora", chave: "agora.rajada", rotulo: "Rajada medida no porto",
      antes: antes.agora.rajada, agora: agora.agora.rajada, delta: l.rajada, formato: fmtKm, peso: 82,
      grave: (a, b) => b >= 40 && a < 40,
    });
  }

  /* ------------------------------------------------- ordena e deduplica */
  const tiposDaApi = new Set(achadas.filter((m) => m.origem === "api").map((m) => m.tipo));
  return achadas
    .filter((m) => !(m.origem === "painel" && tiposDaApi.has(m.tipo)))
    .sort((a, b) => Number(b.grave) - Number(a.grave) || a.peso - b.peso);
}

/* --------------------------------------------------------- texto do aviso */
/** Texto pronto (só dados reais), usado quando a IA não responde. */
export function textoMudancaPadrao(mudancas: Mudanca[], p: Previsao | null): string {
  const principais = mudancas.slice(0, 4).map((m) => m.frase);
  const emoji = mudancas.some((m) => m.tipo === "chuva")
    ? "🌧️"
    : mudancas.some((m) => m.tipo === "vento")
      ? "💨"
      : mudancas.some((m) => m.tipo === "boletim")
        ? "📣"
        : "🔄";
  const partes = [`${emoji} A previsão do porto mudou: ${principais.join("; ")}.`];
  if (p) {
    const a = p.agora;
    partes.push(
      `Agora em ${p.cidade}: ${a.temperatura}°C, ${a.descricao.toLowerCase()}, vento ${a.ventoKmh} km/h ${a.ventoDirecao}.`,
    );
    const hoje = p.dias[0];
    if (hoje) partes.push(`Hoje: máx ${hoje.max}°, mín ${hoje.min}°, ${hoje.chanceChuva}% de chuva.`);
  }
  partes.push("Fonte: SIMPORT®/APPA. Confira a tela Tempo antes de pegar a estrada.");
  return partes.join(" ").slice(0, 480);
}

const SISTEMA_RADAR = `Você avisa os caminhoneiros do Porto de Paranaguá (PR), no chat do app CopaLinks, quando a PREVISÃO DO TEMPO MUDA.
Regras:
- Português do Brasil, tom de colega de trabalho, claro e sem alarmismo; 2 a 4 frases; no máximo 440 caracteres; comece com um emoji do tempo.
- Use SOMENTE as mudanças e os dados fornecidos. Nunca invente número, horário ou volume de chuva.
- Diga o que mudou (de → para), em que período vale e o que o motorista deve fazer na prática (lona amarrada, pista molhada e distância maior, freios, faróis, vento na carreta vazia, maré para quem espera no pátio).
- Sem título, sem hashtags, sem aspas e sem lista com travessão.`;

/** Aviso escrito pela IA (Gemini pelo Composio) com as mudanças reais. */
async function escreverAviso(mudancas: Mudanca[], p: Previsao | null): Promise<string> {
  const base = textoMudancaPadrao(mudancas, p);
  const lista = mudancas
    .slice(0, 6)
    .map((m) => `- ${m.rotulo}: ${m.antes} → ${m.agora}${m.grave ? " (grave)" : ""}`)
    .join("\n");
  const proximas = (p?.horas ?? [])
    .filter((h) => h.ts * 1000 >= Date.now() - 30 * 60_000)
    .slice(0, 6)
    .map((h) => `${h.hora}: ${h.descricao}, ${h.temperatura}°C, chuva ${h.chanceChuva}% (${h.chuvaMm} mm), rajadas ${h.rajadaKmh} km/h`)
    .join("\n");
  try {
    const { texto } = await geminiViaComposio(
      SISTEMA_RADAR,
      `Mudanças detectadas na previsão:\n${lista}\n\nComo está agora no porto:\n${base}\n\nPróximas horas:\n${proximas || "(sem dados)"}\n\nEscreva o aviso.`,
      { rapido: true, reserva: false, maxTokens: 460, temperatura: 0.5, timeoutMs: 12000 },
    );
    const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
    return limpo.length >= 25 ? limpo.slice(0, 480) : base;
  } catch {
    return base;
  }
}

/* ------------------------------------------------------------- estado */
async function lerConfig(chave: string) {
  const [l] = await db.select().from(configuracao).where(eq(configuracao.chave, chave)).limit(1);
  return l?.valor ?? null;
}

async function gravarConfig(chave: string, valor: string) {
  await db
    .insert(configuracao)
    .values({ chave, valor })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
}

/** Instantâneo válido guardado no banco (null quando ainda não existe). */
export function instantaneoValido(bruto: string | null): InstantaneoClima | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as InstantaneoClima;
    if (typeof j?.em !== "number" || !j?.fontes) return null;
    return j;
  } catch {
    return null;
  }
}

const lerInstantaneo = async () => instantaneoValido(await lerConfig(CHAVE_INSTANTANEO).catch(() => null));
const gravarInstantaneo = (i: InstantaneoClima) => gravarConfig(CHAVE_INSTANTANEO, JSON.stringify(i));

/** Data de hoje no horário de Brasília (a assinatura de mudança vale por dia). */
export function hojeLocal(agora: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(agora);
}

/** Hora local de Brasília (0-23), usada para agrupar a assinatura por bloco. */
function horaLocal(agora: Date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(agora),
  );
}

/**
 * Assinatura única de uma mudança: `<dia>:<bloco de 3 h>:<chave>:<de>><para>`.
 * O bloco de 3 h deixa a mesma mudança voltar a ser avisada mais tarde (o tempo
 * oscila), sem permitir repetição dentro da mesma janela — o intervalo mínimo
 * entre avisos e o teto por hora continuam valendo.
 */
export function assinaturaDoDia(m: Mudanca, agora: Date = new Date()) {
  return `${hojeLocal(agora)}:b${Math.floor(horaLocal(agora) / 3)}:${m.assinatura}`.slice(0, 180);
}

/* ---------------------------------------------------------- leituras */
/**
 * Previsão fresca para comparar. Reaproveita a que o cron já leu quando ela
 * tem menos de 1 minuto; senão lê a APPA de novo. No modo `suave` (caminho do
 * app aberto) vale o cache de 10 min da tela, para não segurar a resposta; no
 * caminho do cron a leitura é forçada (o radar não pode esperar o cache).
 */
async function lerPrevisao(passada: Previsao | undefined, suave = false): Promise<Previsao | null> {
  if (passada) {
    const idade = Date.now() - new Date(passada.atualizadoEm).getTime();
    if (Number.isFinite(idade) && idade < 60_000) return passada;
  }
  try {
    return await obterPrevisao(!suave);
  } catch {
    return passada ?? null;
  }
}

/**
 * Painel da Simport PELO COMPOSIO, com cache próprio (padrão: 30 min) para não
 * gastar chamadas de API à toa. Se o Composio estiver desconfigurado ou fora
 * do ar, devolve a última leitura guardada — o radar segue com a API.
 */
export async function lerPainel(cfg: ConfigRadar, forcar = false): Promise<PainelSimport | null> {
  const guardado = instantaneoValidoPainel(await lerConfig(CHAVE_PAINEL).catch(() => null));
  if (!forcar && guardado && Date.now() - guardado.em < cfg.painelMs) return guardado.dados;
  if (!(await composioConfigurado().catch(() => false))) return guardado?.dados ?? null;
  try {
    const dados = parsearPainelSimport(await painelSimportComposio());
    if (!dados) return guardado?.dados ?? null;
    await gravarConfig(CHAVE_PAINEL, JSON.stringify({ em: Date.now(), dados }));
    return dados;
  } catch {
    return guardado?.dados ?? null;
  }
}

function instantaneoValidoPainel(bruto: string | null): { em: number; dados: PainelSimport } | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as { em: number; dados: PainelSimport };
    if (typeof j?.em !== "number" || !j?.dados) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * Motivo para não avisar agora (intervalo mínimo / teto por hora) ou null.
 * Conta AVISOS PUBLICADOS (linhas com `mensagemId`), não mudanças: um mesmo
 * aviso pode reunir várias mudanças e isso não pode gastar a cota da hora.
 */
async function limiteDeAvisos(cfg: ConfigRadar): Promise<string | null> {
  const publicados = sql`${climaMudancas.mensagemId} is not null`;
  const [ultimo] = await db
    .select({ em: climaMudancas.criadoEm })
    .from(climaMudancas)
    .where(publicados)
    .orderBy(desc(climaMudancas.id))
    .limit(1);
  if (ultimo?.em && Date.now() - ultimo.em.getTime() < cfg.avisoMinMs) {
    const falta = Math.ceil((cfg.avisoMinMs - (Date.now() - ultimo.em.getTime())) / 60_000);
    return `aguardando ${falta} min do último aviso`;
  }
  const [hora] = await db
    .select({ n: sql<number>`count(distinct ${climaMudancas.mensagemId})::int` })
    .from(climaMudancas)
    .where(sql`${climaMudancas.criadoEm} > now() - interval '1 hour' and ${publicados}`);
  if ((hora?.n ?? 0) >= cfg.maxPorHora) return `limite de ${cfg.maxPorHora} avisos por hora`;
  return null;
}

/* ------------------------------------------------------------ radar */
/**
 * Ciclo do radar: lê de novo, compara com o último aviso e, se a previsão
 * mudou de verdade, posta no chat + Web Push (app fechado inclusive).
 * Nunca joga erro para cima — o cron não pode quebrar por causa do clima.
 */
export async function verificarMudancasPrevisao(
  opcoes: {
    forcar?: boolean;
    previsao?: Previsao;
    registrarSomente?: boolean;
    /** Usa o cache de 10 min em vez de forçar a leitura (caminho do app aberto). */
    suave?: boolean;
  } = {},
): Promise<ResultadoRadar> {
  const cfg = configRadar();
  if (!cfg.ativo) return { rodou: false, postou: false, motivo: "radar desligado", mudancas: [] };
  try {
    const ultima = Number(await lerConfig(CHAVE_ULTIMA)) || 0;
    if (!opcoes.forcar && Date.now() - ultima < cfg.intervaloMs) {
      return { rodou: false, postou: false, motivo: "aguardando intervalo", mudancas: [] };
    }
    // Reserva o ciclo antes de ler: dois cron juntos não leem nem avisam duas vezes.
    await gravarConfig(CHAVE_ULTIMA, String(Date.now()));

    const p = await lerPrevisao(opcoes.previsao, opcoes.suave);
    const painel = await lerPainel(cfg, opcoes.forcar);
    if (!p && !painel) {
      return { rodou: true, postou: false, motivo: "fontes do tempo indisponíveis", mudancas: [] };
    }
    const atual = montarInstantaneo(p, painel);
    if (!atual.api && !atual.painel && !atual.boletim && !atual.agora) {
      return { rodou: true, postou: false, motivo: "leitura incompleta", mudancas: [] };
    }

    const anterior = await lerInstantaneo();
    if (!anterior) {
      // 1ª leitura: registra o que já existe e não avisa coisa antiga.
      await gravarInstantaneo(atual);
      if (!(await lerConfig(CHAVE_SEMEADO))) await gravarConfig(CHAVE_SEMEADO, new Date().toISOString());
      return { rodou: true, postou: false, motivo: "primeira leitura registrada", mudancas: [] };
    }

    const mudancas = detectarMudancas(anterior, atual, cfg.sensibilidade);
    // Sem mudança: mantém o instantâneo do último aviso como referência, para
    // uma mudança lenta (chuva crescendo aos poucos) ser avisada uma vez só.
    if (!mudancas.length) {
      return { rodou: true, postou: false, motivo: "previsão sem mudança", mudancas: [] };
    }

    // O alerta/boletim do clima acabou de falar neste mesmo minuto: a referência
    // avança calada, para não sair duas mensagens juntas no chat.
    if (opcoes.registrarSomente) {
      await gravarInstantaneo(atual);
      return {
        rodou: true,
        postou: false,
        motivo: "alerta do clima já avisou neste ciclo",
        mudancas: mudancas.map((m) => m.rotulo),
      };
    }

    const bloqueio = opcoes.forcar ? null : await limiteDeAvisos(cfg);
    if (bloqueio) {
      return { rodou: true, postou: false, motivo: bloqueio, mudancas: mudancas.map((m) => m.rotulo) };
    }

    // Reserva cada mudança antes de escrever: a mesma mudança não repete no
    // mesmo bloco de 3 h (e o intervalo/limite por hora seguem valendo).
    const novas: (Mudanca & { id: number })[] = [];
    for (const m of mudancas.slice(0, 6)) {
      const assinatura = assinaturaDoDia(m);
      const [reservada] = await db
        .insert(climaMudancas)
        .values({ assinatura, resumo: m.frase.slice(0, 220), grave: m.grave ? 1 : 0 })
        .onConflictDoNothing()
        .returning({ id: climaMudancas.id });
      if (reservada) novas.push({ ...m, id: reservada.id });
    }
    if (!novas.length) {
      await gravarInstantaneo(atual);
      return { rodou: true, postou: false, motivo: "mudanças já avisadas hoje", mudancas: [] };
    }

    const grave = novas.some((m) => m.grave);
    const texto = await escreverAviso(novas, p);
    const [mensagem] = await db
      .insert(chatMensagens)
      .values({ motoristaId: MOTORISTA_SISTEMA, nome: NOME_RADAR, texto })
      .returning();

    let push = "não";
    if (mensagem) {
      await db
        .update(climaMudancas)
        .set({ mensagemId: mensagem.id })
        .where(inArray(climaMudancas.id, novas.map((m) => m.id)))
        .catch(() => null);
      // Web Push (nome do agente + texto) para todos os aparelhos: chega mesmo
      // com o app fechado, pela mão do Service Worker. Grave = fica na tela.
      const r = await notificarMensagemChat(
        { id: mensagem.id, motoristaId: MOTORISTA_SISTEMA, nome: NOME_RADAR, texto },
        { requireInteraction: grave },
      ).catch(() => null);
      if (r && "enviadas" in r && r.enviadas > 0) push = `${r.enviadas} aparelho(s)`;
    }

    // Só depois de avisar é que a referência avança.
    await gravarInstantaneo(atual);
    // Retenção: 30 dias de histórico de mudanças (o limite é por dia/hora).
    await db
      .delete(climaMudancas)
      .where(sql`${climaMudancas.criadoEm} < now() - interval '30 days'`)
      .catch(() => null);

    return {
      rodou: true,
      postou: true,
      motivo: `${novas.length} mudança(s) avisada(s) no chat (push: ${push})`,
      mudancas: novas.map((m) => m.rotulo),
    };
  } catch (e) {
    return {
      rodou: false,
      postou: false,
      motivo: `falha: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
      mudancas: [],
    };
  }
}

/* --------------------------------------------- batida leve (app aberto) */

/** Guarda em memória: evita encostar no banco a cada pedido do aplicativo. */
let ultimaBatida = 0;
/** Intervalo mínimo entre batidas no mesmo processo (ms). */
const BATIDA_MS = 60_000;

/**
 * Batida do radar pelo caminho que o app ABERTO já chama o tempo todo
 * (`/api/atualizar`): assim o monitoramento continua vivo mesmo quando o
 * `/api/cron` do provedor não roda a cada minuto (plano Hobby, job do Supabase
 * desligado etc.). Com o app fechado, quem garante o aviso é o cron.
 *
 * Custo normal: uma comparação de horário (nada de banco, nada de rede). A
 * cada 60 s no máximo ela consulta o intervalo no banco e, se já passaram os
 * `CLIMA_MONITOR_MIN` minutos desde a última leitura, roda um ciclo `suave`
 * (usa o cache de 10 min da previsão em vez de forçar a leitura).
 * Nunca joga erro para cima e nunca atrasa a resposta do aplicativo.
 */
export async function tickRadar(): Promise<ResultadoRadar | null> {
  const cfg = configRadar();
  if (!cfg.ativo) return null;
  const agora = Date.now();
  if (agora - ultimaBatida < BATIDA_MS) return null;
  ultimaBatida = agora;
  try {
    return await verificarMudancasPrevisao({ suave: true });
  } catch {
    return null;
  }
}

/** Zera a guarda da batida (usado nos testes). */
export function resetarTickRadar() {
  ultimaBatida = 0;
}

/* ----------------------------------------------------------- status (UI) */
export type StatusRadarClima = {
  ativo: boolean;
  sensibilidade: Sensibilidade;
  intervaloMin: number;
  painelMin: number;
  ultimaVerificacao: string | null;
  ultimaMudanca: { em: string; resumo: string; grave: boolean } | null;
  mudancas24h: number;
  fontes: { simport: boolean; estacao: boolean; painel: boolean; composio: boolean };
  composio: boolean;
};

/** Estado do radar para a tela Tempo e para o painel do administrador. */
export async function statusRadarClima(): Promise<StatusRadarClima> {
  const cfg = configRadar();
  const padrao: StatusRadarClima = {
    ativo: cfg.ativo,
    sensibilidade: cfg.sensibilidade,
    intervaloMin: Math.round(cfg.intervaloMs / 60_000),
    painelMin: Math.round(cfg.painelMs / 60_000),
    ultimaVerificacao: null,
    ultimaMudanca: null,
    mudancas24h: 0,
    fontes: { simport: false, estacao: false, painel: false, composio: false },
    composio: false,
  };
  try {
    const [ultima, instantaneo, [mudanca], [total], composio] = await Promise.all([
      lerConfig(CHAVE_ULTIMA),
      lerInstantaneo(),
      db
        .select({ em: climaMudancas.criadoEm, resumo: climaMudancas.resumo, grave: climaMudancas.grave })
        .from(climaMudancas)
        .orderBy(desc(climaMudancas.id))
        .limit(1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(climaMudancas)
        .where(sql`${climaMudancas.criadoEm} > now() - interval '24 hours'`),
      composioConfigurado().catch(() => false),
    ]);
    return {
      ...padrao,
      ultimaVerificacao: ultima ? new Date(Number(ultima)).toISOString() : null,
      ultimaMudanca: mudanca
        ? { em: mudanca.em.toISOString(), resumo: mudanca.resumo, grave: mudanca.grave === 1 }
        : null,
      mudancas24h: total?.n ?? 0,
      fontes: {
        simport: Boolean(instantaneo?.fontes.simport),
        estacao: Boolean(instantaneo?.fontes.estacao),
        painel: Boolean(instantaneo?.fontes.painel),
        composio: Boolean(instantaneo?.fontes.composio),
      },
      composio,
    };
  } catch {
    return padrao;
  }
}
