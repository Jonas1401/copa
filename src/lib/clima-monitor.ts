import { createHash } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, climaMudancas, configuracao } from "@/db/schema";
import { notificarMensagemChat } from "@/lib/chat-push";
import {
  climaAgoraComposio,
  composioConfigurado,
  geminiViaComposio,
  type ClimaComposio,
} from "@/lib/composio";
import {
  ALERTA_GRAVE,
  ROTULO_METODO,
  condicaoDoPainel,
  gravidadeDoPainel,
  horaDaChuvaForte,
  inicioDaChuva,
  lerPainelAppa,
  normalizarPainelAppa,
  parsearPainelLivre,
  parsearPainelSimport,
  type DadosPainelAppa,
  type MetodoLeituraAppa,
  type PainelSimport,
  type TentativaLeituraAppa,
} from "@/lib/appa-painel";
import { GRAVIDADE, obterPrevisao, type Previsao } from "@/lib/tempo";
import { checarCota, registrarAviso } from "@/lib/notificacoes-cota";

/**
 * Reexportados do leitor do painel (`src/lib/appa-painel-texto.ts`), onde os
 * parsers puros moram desde a leitura com fallback automático.
 */
export { normalizarPainelAppa, parsearPainelLivre, parsearPainelSimport };
export type { DadosPainelAppa, MetodoLeituraAppa, PainelSimport, TentativaLeituraAppa };

/**
 * RADAR DA PREVISÃO — monitor constante do tempo com FALLBACK (SÓ servidor).
 *
 * O `/api/cron` (a cada minuto) chama `verificarMudancasPrevisao()`. O radar
 * lê a previsão do porto de novo a cada `CLIMA_MONITOR_MIN` minutos (padrão 5)
 * por dois caminhos ao mesmo tempo:
 *
 *   1. a API estruturada do SIMPORT® — Dashboard Meteoceanográfico da APPA
 *      (modelo WRF hora a hora, estação do porto, boletim e Open-Meteo), a
 *      mesma que alimenta a tela "Tempo";
 *   2. o PAINEL PÚBLICO (https://weather-appa.app.simport.com.br/) a cada
 *      `CLIMA_MONITOR_PAINEL_MIN` minutos (padrão 5), lido com FALLBACK
 *      AUTOMÁTICO por `lerPainelAppa` (`src/lib/appa-painel.ts`): API/JSON →
 *      HTTP + HTML → navegador headless (Playwright) → captura de tela + OCR →
 *      Composio. Se um método não consegue ler, o próximo entra sozinho — o
 *      Composio é um método ADICIONAL, nunca o único responsável, e cada
 *      tentativa fica registrada no log de diagnóstico do painel.
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
 *     chat; em mudança grave (chuva forte, tempestade/vendaval, rajada
 *     ≥ 40 km/h ou boletim/alerta da APPA com tempo ruim) o aviso fica na tela
 *     até o motorista tocar.
 *
 * O que entra na comparação (entre outros): começo e intensidade da chuva,
 * chuva forte, tempestade, vento/rajada, condição do tempo, boletim da APPA,
 * ALERTA NOVO no painel e a tábua de marés.
 *
 * Antispam (o radar fala só quando vale a pena):
 *   - 1ª leitura apenas registra o instantâneo, sem avisar nada antigo;
 *   - a comparação é sempre contra o ÚLTIMO AVISO, então uma mudança lenta
 *     (ex.: a chuva crescendo aos poucos) é avisada uma única vez;
 *   - cada mudança tem assinatura única por bloco de 3 h (`clima_mudancas`):
 *     o mesmo "de 20% para 75%" não repete na mesma janela;
 *   - SÓ MUDA O QUE IMPORTA PARA O PUSH: chuva, vento, condição do tempo,
 *     alerta e boletim acordam o celular; oscilação de temperatura, maré e
 *     horário do sol apenas avançam a referência (ficam registradas para a
 *     comparação seguinte, sem notificação);
 *   - a cota comum (`src/lib/notificacoes-cota.ts`) limita os avisos:
 *     `CLIMA_MONITOR_AVISO_MIN` (padrão 45 min) entre avisos,
 *     `CLIMA_MONITOR_MAX_HORA` (2) por hora e `CLIMA_MONITOR_MAX_DIA` (8) por
 *     dia; mudança GRAVE passa do teto com piso de 15 min entre avisos;
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
/** Último erro ao ler o painel da APPA — só quando TODOS os métodos falharam. */
const CHAVE_PAINEL_ERRO = "clima_monitor_painel_erro";
/** Log de diagnóstico (uma linha por método tentado) da última leitura do painel. */
const CHAVE_PAINEL_DIAG = "clima_monitor_painel_diag";
/** Último erro ao ler a medição do tempo pelo Composio (diagnóstico). */
const CHAVE_COMPOSIO_ERRO = "clima_monitor_composio_erro";

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
  /** Intervalo mínimo entre dois avisos do radar (min). */
  avisoMinMs: number;
  /** Teto de avisos por hora. */
  maxPorHora: number;
  /** Teto de avisos por dia (horário de Brasília). */
  maxPorDia: number;
  /** Piso entre dois avisos GRAVES (min): mudança séria passa do teto. */
  minGraveMs: number;
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
    painelMs: numero(ambiente.CLIMA_MONITOR_PAINEL_MIN, 5) * 60_000,
    avisoMinMs: numero(ambiente.CLIMA_MONITOR_AVISO_MIN, 45) * 60_000,
    maxPorHora: numero(ambiente.CLIMA_MONITOR_MAX_HORA, 2),
    maxPorDia: numero(ambiente.CLIMA_MONITOR_MAX_DIA, 8),
    minGraveMs: numero(ambiente.CLIMA_MONITOR_MIN_GRAVE, 15) * 60_000,
  };
}

/**
 * Tipos de mudança que merecem acordar o celular do motorista. Oscilação de
 * temperatura, maré e horário do sol ficam registradas para a comparação
 * seguinte — sem notificação — porque não mudam o que ele faz na estrada.
 */
export const TIPOS_RELEVANTES: ReadonlySet<TipoMudanca> = new Set<TipoMudanca>([
  "chuva",
  "vento",
  "condicao",
  "alerta",
  "boletim",
]);

/** Só as mudanças que valem uma notificação (as demais só viram referência). */
export function mudancasRelevantes(mudancas: Mudanca[]): Mudanca[] {
  return mudancas.filter((m) => TIPOS_RELEVANTES.has(m.tipo));
}

/* ------------------------------------------------------------- tipos */
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
  /**
   * Painel público da APPA lido pelo radar (API/JSON, HTML, navegador, OCR ou
   * Composio — quem conseguir). `alertas`, `condicao` e `gravidade` entram na
   * detecção de mudança; `leitura` é o FORMATO ÚNICO que o app consome.
   */
  painel: {
    chuvaProb24h: number;
    chuvaMm24h: number;
    ventoNosMax: number;
    mares: string;
    sol: string;
    alertas: string[];
    condicao: string;
    gravidade: number;
    /** Horário em que a chuva começa (null = sem chuva prevista). */
    inicioChuva: string | null;
    /** Horário do pico de chuva forte (null = sem chuva forte). */
    chuvaForteHora: string | null;
    /** Método que fez esta leitura (diagnóstico; não entra na comparação). */
    metodo?: MetodoLeituraAppa | null;
    leitura?: DadosPainelAppa | null;
  } | null;
  /** Medição no porto (estação da APPA ou OpenWeather pelo Composio). */
  agora: {
    fonte: string;
    temperatura: number;
    vento: number;
    rajada: number;
    umidade: number;
    descricao: string;
  } | null;
  /**
   * Medição independente lida PELO COMPOSIO (ferramenta WEATHERMAP_WEATHER /
   * OpenWeather). É a segunda opinião do radar: cobre o tempo atual mesmo
   * quando a estação da APPA e o WRF falham.
   */
  composioAgora: {
    temperatura: number;
    sensacao: number;
    vento: number;
    rajada: number;
    umidade: number;
    gravidade: number;
    descricao: string;
  } | null;
};

export type TipoMudanca =
  | "chuva"
  | "vento"
  | "temperatura"
  | "condicao"
  | "boletim"
  | "alerta"
  | "mare"
  | "sol"
  | "medicao";

export type Mudanca = {
  tipo: TipoMudanca;
  /**
   * De onde veio o dado: api = WRF/estação · painel = página da APPA lida pelo
   * Composio · composio = medição do Composio (OpenWeather) · agora = estação
   * do porto · boletim = boletim da APPA.
   */
  origem: "api" | "painel" | "composio" | "boletim" | "agora";
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

/* ---------------------------------------- leitura do painel (com fallback) */
/**
 * O painel da APPA é lido por `lerPainelAppa` (`src/lib/appa-painel.ts`), que
 * tenta API/JSON → HTTP + HTML → navegador headless → OCR → Composio, nessa
 * ordem, e devolve SEMPRE o mesmo formato normalizado (`DadosPainelAppa`).
 * Aqui ficam só o cache, os diagnósticos e a ligação com o banco.
 */
const r1 = (n: number) => Math.round(n * 10) / 10;

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
  cc: ClimaComposio | null = null,
  /** Método que leu o painel nesta rodada (aparece no diagnóstico). */
  metodoPainel: MetodoLeituraAppa | null = null,
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
    painel: painel
      ? (() => {
          const alertas = painel.alertas ?? [];
          const leitura = normalizarPainelAppa(painel, { metodo: metodoPainel, agora: em });
          return {
            chuvaProb24h: Math.max(0, ...painel.chuva.map((c) => c.prob)),
            chuvaMm24h: r1(painel.chuva.reduce((s, c) => s + c.mm, 0)),
            ventoNosMax: r1(Math.max(0, ...painel.vento.map((v) => v.nos))),
            mares: painel.mares
              .map((m) => `${m.hora} ${r1(m.altura).toString().replace(".", ",")}m ${m.tipo}`)
              .join("; "),
            sol: [painel.nascerSol, painel.porSol].filter(Boolean).join("/") || "-",
            alertas,
            condicao: condicaoDoPainel(painel, alertas),
            gravidade: gravidadeDoPainel(painel, alertas),
            inicioChuva: inicioDaChuva(painel),
            chuvaForteHora: horaDaChuvaForte(painel),
            metodo: metodoPainel,
            leitura,
          };
        })()
      : null,
    agora,
    composioAgora: cc
      ? {
          temperatura: Math.round(cc.temperatura),
          sensacao: Math.round(cc.sensacao),
          vento: Math.round(cc.ventoKmh),
          rajada: Math.round(cc.rajadaKmh),
          umidade: cc.umidade,
          gravidade: gravidadeOpenWeather(cc.codigo),
          descricao: cc.descricao || "sem descrição",
        }
      : null,
  };
}

/** Código OpenWeather (Composio) → gravidade, na mesma escala dos ícones do app. */
export function gravidadeOpenWeather(codigo: number): number {
  if (codigo >= 200 && codigo < 300) return 7; // trovoadas
  if (codigo === 502 || codigo === 503 || codigo === 504 || codigo === 522) return 6;
  if (codigo >= 300 && codigo < 400) return 4; // garoa
  if (codigo >= 500 && codigo < 600) return 5; // chuva
  if (codigo >= 700 && codigo < 800) return 3; // neblina
  if (codigo === 800) return 0;
  if (codigo === 801 || codigo === 802) return 1;
  return 2;
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

    /* ------------------------- alertas e condição do painel da APPA */
    // Alerta meteorológico NOVO no painel (tempestade, chuva forte, vendaval,
    // ressaca…) vira aviso — e sai como grave quando é tempo ruim de verdade.
    const alertasAntes = new Set((antes.painel.alertas ?? []).map(normalizarTexto));
    for (const alerta of agora.painel.alertas ?? []) {
      const chave = normalizarTexto(alerta);
      if (!chave || alertasAntes.has(chave)) continue;
      achadas.push({
        tipo: "alerta",
        origem: "painel",
        rotulo: "Novo alerta no painel da APPA",
        antes: "sem esse alerta",
        agora: alerta.slice(0, 200),
        frase: `novo alerta meteorológico no painel da APPA: ${alerta.slice(0, 180)}`,
        grave: ALERTA_GRAVE.test(alerta),
        assinatura: `alerta:${curtas8(chave)}`,
        peso: 3,
      });
    }

    // Horário da chuva no painel: "começa às 14h" → "começa às 20h" é mudança
    // de previsão de verdade (e não repete enquanto o horário não mudar).
    const inicioA = antes.painel.inicioChuva ?? null;
    const inicioB = agora.painel.inicioChuva ?? null;
    if (inicioA !== inicioB && (inicioA || inicioB)) {
      achadas.push({
        tipo: "chuva",
        origem: "painel",
        rotulo: "Horário da chuva no painel da APPA",
        antes: inicioA ?? "sem chuva prevista",
        agora: inicioB ?? "sem chuva prevista",
        frase: inicioB
          ? `a chuva no painel da APPA mudou de horário (${inicioA ?? "sem previsão"} → ${inicioB})`
          : `o painel da APPA tirou a chuva da previsão (era ${inicioA})`,
        grave: false,
        assinatura: `painelHoraChuva:${inicioA ?? "-"}>${inicioB ?? "-"}`,
        peso: 63,
      });
    }
    // Pico de chuva forte marcado no painel (novo ou em outro horário).
    const forteA = antes.painel.chuvaForteHora ?? null;
    const forteB = agora.painel.chuvaForteHora ?? null;
    if (forteA !== forteB && forteB) {
      achadas.push({
        tipo: "chuva",
        origem: "painel",
        rotulo: "Chuva forte no painel da APPA",
        antes: forteA ? `chuva forte às ${forteA}` : "sem chuva forte",
        agora: `chuva forte às ${forteB}`,
        frase: `o painel da APPA marca chuva forte para as ${forteB}`,
        grave: true,
        assinatura: `painelChuvaForte:${forteB}`,
        peso: 8,
      });
    }

    // Condição do painel (sem chuva → chuva → chuva forte → tempestade).
    const gPainelA = antes.painel.gravidade ?? 0;
    const gPainelB = agora.painel.gravidade ?? 0;
    if (
      Math.abs(gPainelB - gPainelA) >= Math.max(1, l.gravidade) &&
      (antes.painel.condicao ?? "") !== (agora.painel.condicao ?? "")
    ) {
      achadas.push({
        tipo: "condicao",
        origem: "painel",
        rotulo: "Condição do tempo no painel da APPA",
        antes: antes.painel.condicao || "sem previsão",
        agora: agora.painel.condicao || "sem previsão",
        frase: `a condição no painel da APPA mudou de ${(antes.painel.condicao || "sem previsão").toLowerCase()} para ${(agora.painel.condicao || "sem previsão").toLowerCase()}`,
        grave: gPainelB >= 6 && gPainelA < 6,
        assinatura: `painelCondicao:${gPainelA}>${gPainelB}`,
        peso: 28,
      });
    }
  }

  /* ------------------------------- medição independente PELO COMPOSIO */
  if (antes.composioAgora && agora.composioAgora) {
    const c = "composio" as const;
    compararNumero({
      tipo: "medicao", origem: c, chave: "composio.temp", rotulo: "Temperatura pelo Composio",
      antes: antes.composioAgora.temperatura, agora: agora.composioAgora.temperatura,
      delta: l.tempAgora, formato: fmtGrau, peso: 84,
    });
    compararNumero({
      tipo: "vento", origem: c, chave: "composio.rajada", rotulo: "Rajada pelo Composio",
      antes: antes.composioAgora.rajada, agora: agora.composioAgora.rajada,
      delta: l.rajada, formato: fmtKm, peso: 24, grave: (a, b) => b >= 40 && a < 40,
    });
    compararNumero({
      tipo: "vento", origem: c, chave: "composio.vento", rotulo: "Vento pelo Composio",
      antes: antes.composioAgora.vento, agora: agora.composioAgora.vento,
      delta: l.vento, formato: fmtKm, peso: 26,
    });
    compararNumero({
      tipo: "chuva", origem: c, chave: "composio.umidade", rotulo: "Umidade pelo Composio",
      antes: antes.composioAgora.umidade, agora: agora.composioAgora.umidade,
      delta: 15, formato: (n) => `${Math.round(n)}%`, peso: 64,
    });
    const gA = antes.composioAgora.gravidade;
    const gB = agora.composioAgora.gravidade;
    if (Math.abs(gB - gA) >= Math.max(1, l.gravidade)) {
      achadas.push({
        tipo: "condicao",
        origem: c,
        rotulo: "Condição medida pelo Composio",
        antes: antes.composioAgora.descricao,
        agora: agora.composioAgora.descricao,
        frase: `o Composio mudou a condição de ${antes.composioAgora.descricao.toLowerCase()} para ${agora.composioAgora.descricao.toLowerCase()}`,
        grave: gB >= GRAVIDADE.chuva && gA < GRAVIDADE.chuva,
        assinatura: `composioCondicao:${gA}>${gB}`,
        peso: 32,
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
  // Quando a API estruturada já contou a mesma história, o painel e o Composio
  // não repetem: elas entram como segunda opinião quando a API está fora do ar.
  const tiposDaApi = new Set(achadas.filter((m) => m.origem === "api").map((m) => m.tipo));
  return achadas
    .filter((m) => !((m.origem === "painel" || m.origem === "composio") && tiposDaApi.has(m.tipo)))
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
      : mudancas.some((m) => m.tipo === "alerta" || m.tipo === "boletim")
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
 * Medição atual PELO COMPOSIO (WEATHERMAP_WEATHER / OpenWeather), com cache em
 * memória de 10 min. É a segunda opinião do radar: funciona mesmo quando a
 * estação da APPA e o WRF estão fora do ar.
 */
let cacheComposio: { em: number; dados: ClimaComposio | null } | null = null;
const VIDA_CACHE_COMPOSIO = 10 * 60_000;

export async function lerComposioAgora(forcar = false): Promise<ClimaComposio | null> {
  if (!forcar && cacheComposio && Date.now() - cacheComposio.em < VIDA_CACHE_COMPOSIO) {
    return cacheComposio.dados;
  }
  if (!(await composioConfigurado().catch(() => false))) {
    await gravarDiagnostico(CHAVE_COMPOSIO_ERRO, "COMPOSIO_API_KEY não configurada").catch(() => null);
    cacheComposio = { em: Date.now(), dados: null };
    return null;
  }
  let dados: ClimaComposio | null = null;
  try {
    dados = await climaAgoraComposio();
  } catch (e) {
    await gravarDiagnostico(CHAVE_COMPOSIO_ERRO, e instanceof Error ? e.message : String(e)).catch(() => null);
    dados = null;
  }
  if (dados) await gravarDiagnostico(CHAVE_COMPOSIO_ERRO, null).catch(() => null);
  cacheComposio = { em: Date.now(), dados };
  return dados;
}

/** Zera o cache da medição do Composio (usado nos testes). */
export function resetarCacheComposio() {
  cacheComposio = null;
}

/**
 * Painel da APPA com FALLBACK AUTOMÁTICO, cacheado por `cfg.painelMs`
 * (padrão: 5 min, o mesmo passo do radar). A leitura em si é do
 * `lerPainelAppa` — API/JSON → HTTP + HTML → navegador headless → OCR →
 * Composio — e aqui só se guarda o resultado:
 *
 *   - `clima_monitor_painel`      última leitura BOA (dados + método usado);
 *   - `clima_monitor_painel_diag` log de diagnóstico da última rodada
 *                                 (tentativa por tentativa, com o motivo);
 *   - `clima_monitor_painel_erro` erro SOMENTE quando todos os métodos
 *                                 falharam (nada de "não lido pelo Composio"
 *                                 quando outro método leu).
 *
 * Se todos falharem, devolve a última leitura guardada — o radar segue com a
 * API estruturada da Simport e com a medição do Composio.
 */
export async function lerPainelComMetodo(
  cfg: ConfigRadar,
  forcar = false,
  opcoes: { previsao?: Previsao | null } = {},
): Promise<{ painel: PainelSimport | null; metodo: MetodoLeituraAppa | null; leitura: DadosPainelAppa | null }> {
  const guardado = instantaneoValidoPainel(await lerConfig(CHAVE_PAINEL).catch(() => null));
  if (!forcar && guardado?.em && Date.now() - guardado.em < cfg.painelMs) {
    return { painel: guardado.dados, metodo: guardado.metodo ?? null, leitura: guardado.normalizado ?? null };
  }

  const r = await lerPainelAppa({ previsao: opcoes.previsao }).catch((e) => {
    // lerPainelAppa não joga erro: isto é só cinto de segurança.
    return {
      ok: false as const,
      metodo: null,
      normalizado: null,
      painel: null,
      tentativas: [] as TentativaLeituraAppa[],
      erro: e instanceof Error ? e.message : String(e),
      texto: "",
    };
  });

  const diag = {
    em: new Date().toISOString(),
    ok: r.ok,
    metodo: r.metodo,
    metodoRotulo: r.metodo ? ROTULO_METODO[r.metodo] : null,
    erro: r.erro,
    tentativas: r.tentativas,
    resumo: resumoLeituraExibicao(r.normalizado, r.metodo),
  };
  await gravarConfig(CHAVE_PAINEL_DIAG, JSON.stringify(diag).slice(0, 6000)).catch(() => null);

  if (r.ok && r.painel) {
    await gravarConfig(
      CHAVE_PAINEL,
      JSON.stringify({
        em: Date.now(),
        dados: r.painel,
        metodo: r.metodo,
        normalizado: r.normalizado,
        tentativas: r.tentativas,
      }),
    ).catch(() => null);
    await gravarDiagnostico(CHAVE_PAINEL_ERRO, null).catch(() => null);
    return { painel: r.painel, metodo: r.metodo, leitura: r.normalizado };
  }

  // TODOS os métodos falharam: aí sim registra o erro (com os motivos).
  await gravarDiagnostico(CHAVE_PAINEL_ERRO, r.erro ?? "painel da APPA não lido").catch(() => null);
  return {
    painel: guardado?.dados ?? null,
    metodo: guardado?.metodo ?? null,
    leitura: guardado?.normalizado ?? null,
  };
}

/**
 * Mesma leitura, devolvendo só o painel (compatibilidade). Quem precisa saber
 * QUAL método leu (o cartão do administrador, o instantâneo do radar) usa
 * `lerPainelComMetodo`.
 */
export async function lerPainel(
  cfg: ConfigRadar,
  forcar = false,
  opcoes: { previsao?: Previsao | null } = {},
): Promise<PainelSimport | null> {
  return (await lerPainelComMetodo(cfg, forcar, opcoes)).painel;
}

/** Texto curto do que a leitura trouxe (usado no diagnóstico guardado). */
function resumoLeituraExibicao(d: DadosPainelAppa | null, metodo: MetodoLeituraAppa | null): string {
  if (!d || !metodo) return "sem leitura";
  const partes = [d.chuva, d.vento, `temp. ${d.temperatura}`];
  if (d.alertas.length) partes.push(`${d.alertas.length} alerta(s)`);
  return `${ROTULO_METODO[metodo]}: ${partes.join(" · ")}`.slice(0, 240);
}

/** Guarda (ou limpa) o motivo da última falha de uma fonte do radar. */
async function gravarDiagnostico(chave: string, motivo: string | null) {
  if (!motivo) {
    await db.delete(configuracao).where(eq(configuracao.chave, chave));
    return;
  }
  await gravarConfig(chave, motivo.slice(0, 200));
}

/** Última leitura BOA do painel guardada no banco (com o método que a fez). */
function instantaneoValidoPainel(bruto: string | null): {
  em: number;
  dados: PainelSimport;
  metodo?: MetodoLeituraAppa | null;
  normalizado?: DadosPainelAppa | null;
  tentativas?: TentativaLeituraAppa[];
} | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as {
      em: number;
      dados: PainelSimport;
      metodo?: MetodoLeituraAppa | null;
      normalizado?: DadosPainelAppa | null;
      tentativas?: TentativaLeituraAppa[];
    };
    if (typeof j?.em !== "number" || !j?.dados) return null;
    return j;
  } catch {
    return null;
  }
}

/** Log de diagnóstico da última rodada de leitura do painel. */
type DiagnosticoPainel = {
  em: string;
  ok: boolean;
  metodo: MetodoLeituraAppa | null;
  metodoRotulo: string | null;
  erro: string | null;
  tentativas: TentativaLeituraAppa[];
  resumo: string;
};

function diagnosticoValido(bruto: string | null): DiagnosticoPainel | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as DiagnosticoPainel;
    if (!j || typeof j !== "object" || !Array.isArray(j.tentativas)) return null;
    return j;
  } catch {
    return null;
  }
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
    const painelLido = await lerPainelComMetodo(cfg, opcoes.forcar, { previsao: p });
    const painel = painelLido.painel;
    // Segunda opinião: medição do tempo atual PELO COMPOSIO (OpenWeather).
    const cc = await lerComposioAgora(opcoes.forcar);
    if (!p && !painel && !cc) {
      return { rodou: true, postou: false, motivo: "fontes do tempo indisponíveis", mudancas: [] };
    }
    const atual = montarInstantaneo(p, painel, Date.now(), cc, painelLido.metodo);
    if (!atual.api && !atual.painel && !atual.boletim && !atual.agora && !atual.composioAgora) {
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
    // Mudança que não muda a vida de quem está na estrada (temperatura, maré,
    // horário do sol) não vira notificação: avança a referência calada.
    if (!mudancasRelevantes(mudancas).length) {
      await gravarInstantaneo(atual);
      return {
        rodou: true,
        postou: false,
        motivo: "mudança de baixa relevância (só registro)",
        mudancas: mudancas.map((m) => m.rotulo),
      };
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

    // Cota de notificações: piso entre avisos, teto por hora e por dia. Uma
    // mudança GRAVE (chuva forte, temporal, rajada ≥ 40 km/h) é urgente: passa
    // do teto, mas nunca sai em cima do aviso anterior. `forcar` (testes e
    // "Verificar agora" do administrador) ignora a cota.
    const temGrave = mudancas.some((m) => m.grave);
    if (!opcoes.forcar) {
      const cota = await checarCota("radar", {
        urgente: temGrave,
        pisoUrgenteMin: Math.round(cfg.minGraveMs / 60_000),
      });
      if (!cota.liberado) {
        return { rodou: true, postou: false, motivo: cota.motivo, mudancas: mudancas.map((m) => m.rotulo) };
      }
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

    // A cota é registrada junto com o aviso publicado.
    await registrarAviso("radar");
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
  /** Cota de avisos: intervalo mínimo (minutos), tetos por hora e por dia. */
  avisoMinMin: number;
  maxPorHora: number;
  maxPorDia: number;
  ultimaVerificacao: string | null;
  ultimaMudanca: { em: string; resumo: string; grave: boolean } | null;
  mudancas24h: number;
  fontes: { simport: boolean; estacao: boolean; painel: boolean; composio: boolean };
  composio: boolean;
  /**
   * Painel da APPA: `conectado` = alguma leitura deu certo (por QUALQUER
   * método). O erro só aparece quando TODOS os métodos falharam.
   */
  painel: {
    conectado: boolean;
    em: string | null;
    metodo: MetodoLeituraAppa | null;
    metodoRotulo: string | null;
    erro: string | null;
    /** Log de diagnóstico: uma linha por método tentado. */
    tentativas: TentativaLeituraAppa[];
    /** Última leitura no FORMATO ÚNICO (`DadosPainelAppa`). */
    leitura: DadosPainelAppa | null;
    /** Resumo em uma frase (chuva, vento, temperatura). */
    resumo: string | null;
  };
  /** Último erro ao ler a medição do tempo pelo Composio (null = tudo certo). */
  composioErro: string | null;
};

/** Estado do radar para a tela Tempo e para o painel do administrador. */
export async function statusRadarClima(): Promise<StatusRadarClima> {
  const cfg = configRadar();
  const padrao: StatusRadarClima = {
    ativo: cfg.ativo,
    sensibilidade: cfg.sensibilidade,
    intervaloMin: Math.round(cfg.intervaloMs / 60_000),
    painelMin: Math.round(cfg.painelMs / 60_000),
    avisoMinMin: Math.round(cfg.avisoMinMs / 60_000),
    maxPorHora: cfg.maxPorHora,
    maxPorDia: cfg.maxPorDia,
    ultimaVerificacao: null,
    ultimaMudanca: null,
    mudancas24h: 0,
    fontes: { simport: false, estacao: false, painel: false, composio: false },
    composio: false,
    painel: {
      conectado: false,
      em: null,
      metodo: null,
      metodoRotulo: null,
      erro: null,
      tentativas: [],
      leitura: null,
      resumo: null,
    },
    composioErro: null,
  };
  try {
    const [ultima, instantaneo, [mudanca], [total], composio, painelBruto, erroPainel, diagBruto, erroComposio] =
      await Promise.all([
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
        lerConfig(CHAVE_PAINEL),
        lerConfig(CHAVE_PAINEL_ERRO),
        lerConfig(CHAVE_PAINEL_DIAG),
        lerConfig(CHAVE_COMPOSIO_ERRO),
      ]);
    const guardado = instantaneoValidoPainel(painelBruto);
    const diag = diagnosticoValido(diagBruto);
    // Conectado = houve leitura por ALGUM método e nenhuma falha total depois.
    // (Sem `metodo` é porque a leitura é anterior a esta versão; vale a leitura.)
    const metodo = diag?.metodo ?? guardado?.metodo ?? null;
    const conectado = Boolean(!erroPainel && ((diag?.ok ?? false) || Boolean(guardado?.dados)));
    const resumo = diag?.resumo ?? null;
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
      painel: {
        conectado,
        em: guardado?.em ? new Date(guardado.em).toISOString() : null,
        metodo,
        metodoRotulo: metodo ? ROTULO_METODO[metodo] : null,
        // Só quando TODOS os métodos falharam (nada de culpar o Composio).
        erro: erroPainel ?? null,
        tentativas: diag?.tentativas ?? guardado?.tentativas ?? [],
        leitura: diag?.ok === false && !guardado?.normalizado ? null : (guardado?.normalizado ?? null),
        resumo,
      },
      composioErro: erroComposio ?? null,
    };
  } catch {
    return padrao;
  }
}
