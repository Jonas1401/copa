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
 * limite da sensibilidade escolhida — E a previsão traz tempo ruim —, o radar:
 *
 *   - posta UMA mensagem no chat dos motoristas como "📡 Radar da Previsão"
 *     (`motorista_id = 0` = sistema), escrita pela IA (Gemini pelo Composio)
 *     com os números reais — se a IA falhar, vale o texto pronto das regras;
 *   - dispara Web Push para todos os aparelhos: a notificação chega MESMO COM
 *     O APLICATIVO FECHADO (quem exibe é o Service Worker) e, ao tocar, abre o
 *     chat; em aviso grave (chuva forte, tempestade ou boletim/alerta da APPA
 *     com tempo ruim) o aviso fica na tela até o motorista tocar.
 *
 * O QUE O RADAR VIGIA — só a PREVISÃO, nada mais:
 *
 *   - PRÓXIMAS HORAS: modelo WRF (chance/volume de chuva em 6 h e 24 h,
 *     condição prevista) e o painel da APPA (chuva hora a hora, início da
 *     chuva, horário da chuva forte, condição prevista e alertas novos);
 *   - PRÓXIMOS DIAS: hoje e amanhã (chance de chuva) e o boletim da APPA por
 *     dia.
 *
 * E O QUE NÃO VIRA AVISO: vento/rajada, temperatura, tábua de marés, horários
 * do sol e a MEDIÇÃO do tempo atual (estação do porto e Composio). Esses dados
 * continuam na tela Tempo e no diagnóstico do administrador, só não disparam
 * mensagem.
 *
 * QUANDO O RADAR FALA: somente se a previsão trouxer CHUVA (chance ≥ 50% ou
 * volume ≥ 0,5 mm), NEBLINA forte ou TEMPESTADE — inclusive alerta novo do
 * painel sobre esses três. Previsão de TEMPO BOM (a chuva saiu, a chance caiu,
 * o dia ficou firme) NÃO gera mensagem no chat nem notificação: o radar
 * simplesmente avança a referência em silêncio.
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
    gravidade: number; // níveis de condição (0 sol … 7 temporal)
  }
> = {
  baixa: { chuvaProb: 30, chuvaMm: 3, gravidade: 3 },
  media: { chuvaProb: 20, chuvaMm: 1, gravidade: 2 },
  alta: { chuvaProb: 10, chuvaMm: 0.5, gravidade: 1 },
};

/* --------------------------- o que o radar vigia (SÓ a previsão de tempo ruim) */
/**
 * O radar vigia APENAS a previsão — próximas horas e próximos dias — e só
 * avisa quando ela traz CHUVA, NEBLINA forte ou TEMPESTADE. Previsão de tempo
 * bom (ex.: a chuva saiu, a chance caiu) não vira mensagem nem notificação.
 */

/** Chance de chuva (%) a partir da qual a previsão passa a valer aviso. */
export const CHANCE_CHUVA_AVISO = 50;
/** Volume de chuva previsto (mm) a partir do qual vale avisar. */
export const MM_CHUVA_AVISO = 0.5;
/** Gravidade mínima da condição prevista que vira aviso: neblina (3) para cima. */
export const GRAVIDADE_MINIMA_AVISO = GRAVIDADE.neblina;

/** Texto sobre o tempo que o radar vigia: chuva, neblina ou tempestade. */
export const TEMPO_MONITORADO =
  /(chuva|garoa|pancada|precipita|neblina|nevoeiro|n[eé]voa|tempestad|trovoad|trov[ãa]o|temporal)/i;

/** A condição prevista merece aviso? (neblina, garoa, chuva, chuva forte ou tempestade.) */
export const condicaoMereceAviso = (gravidade: number) => gravidade >= GRAVIDADE_MINIMA_AVISO;

/** A chuva prevista merece aviso? (chance ≥ 50% ou volume ≥ 0,5 mm.) */
export const chuvaMereceAviso = (chance: number, mm: number) =>
  chance >= CHANCE_CHUVA_AVISO || mm >= MM_CHUVA_AVISO;

/** O texto (alerta do painel, boletim da APPA) fala de chuva, neblina ou tempestade? */
export const textoMereceAviso = (texto: string) => TEMPO_MONITORADO.test(texto);

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
    painelMs: numero(ambiente.CLIMA_MONITOR_PAINEL_MIN, 5) * 60_000,
    avisoMinMs: numero(ambiente.CLIMA_MONITOR_AVISO_MIN, 20) * 60_000,
    maxPorHora: numero(ambiente.CLIMA_MONITOR_MAX_HORA, 3),
  };
}

/* ------------------------------------------------------------- tipos */
/**
 * Fotografia da previsão guardada a cada ciclo. SÓ os campos de PREVISÃO
 * (`api`, `hoje`, `amanha`, `boletim` e `painel`) entram na comparação do
 * radar; vento, marés/sol e as medições do tempo atual (`agora`,
 * `composioAgora`) ficam no instantâneo apenas para o diagnóstico do
 * administrador — não disparam aviso.
 */
export type InstantaneoClima = {
  em: number;
  fontes: { simport: boolean; estacao: boolean; openMeteo: boolean; composio: boolean; painel: boolean };
  /** Modelo WRF da APPA (próximas 24 h). Vento/rajada: só diagnóstico. */
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
   * Composio — quem conseguir). `chuvaProb24h`, `chuvaMm24h`, `alertas`,
   * `condicao`, `gravidade`, `inicioChuva` e `chuvaForteHora` entram na
   * detecção de mudança (vento/marés/sol, não); `leitura` é o FORMATO ÚNICO
   * que o app consome.
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
  /** Medição no porto (estação da APPA ou OpenWeather pelo Composio). SÓ diagnóstico — não vira aviso. */
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
   * OpenWeather). Aparece no diagnóstico do administrador; como o radar vigia
   * só a PREVISÃO, a medição atual não dispara aviso.
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

/**
 * O radar só trata de mudança na PREVISÃO de tempo ruim:
 *   - chuva    — chance/volume de chuva previsto (próximas horas ou próximos dias);
 *   - condicao — a condição prevista piorou para neblina, garoa, chuva ou tempestade;
 *   - boletim  — boletim da APPA (próximos dias) falando de chuva/neblina/tempestade;
 *   - alerta   — alerta novo no painel da APPA sobre chuva, neblina ou tempestade.
 */
export type TipoMudanca = "chuva" | "condicao" | "boletim" | "alerta";

export type Mudanca = {
  tipo: TipoMudanca;
  /**
   * De onde veio o dado: api = WRF/previsão estruturada (próximas horas e
   * dias) · painel = painel público da APPA · boletim = boletim da APPA.
   */
  origem: "api" | "painel" | "boletim";
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
const fmtMm = (n: number) => `${r1(n).toString().replace(".", ",")} mm`;

/**
 * Compara dois instantâneos e devolve as mudanças que merecem aviso. Regras:
 *
 *   - SÓ A PREVISÃO entra na comparação: próximas horas (WRF 6 h/24 h e o
 *     painel da APPA) e próximos dias (hoje, amanhã e o boletim). Vento,
 *     temperatura, maré, sol e a medição do tempo ATUAL não viram aviso;
 *   - SÓ TEMPO RUIM vira aviso: chuva (chance ≥ 50% ou volume ≥ 0,5 mm),
 *     neblina forte ou tempestade na previsão — inclusive alerta novo do
 *     painel sobre esses três. Previsão melhorando ou de tempo bom NÃO gera
 *     mensagem no chat nem notificação;
 *   - Só compara o que existe nos DOIS lados (fonte fora do ar não vira
 *     mudança) e nunca repete o mesmo fato por duas fontes: quando a API
 *     estruturada já acusou o tipo (ex.: chuva), o painel não repete.
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
    /**
     * Só avisa quando o valor NOVO é previsão de tempo ruim (chuva, neblina
     * ou tempestade). Valor novo de tempo bom = silêncio.
     */
    avisavel: (agora: number) => boolean;
    grave?: (antes: number, agora: number) => boolean;
  }) {
    const a = opcoes.antes;
    const b = opcoes.agora;
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return;
    // Tempo bom na previsão nova (ou a previsão melhorando): sem aviso.
    if (!opcoes.avisavel(b)) return;
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

  /* ------------------- previsão das PRÓXIMAS HORAS (WRF, API estruturada) */
  if (antes.api && agora.api) {
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb6h", rotulo: "Chance de chuva nas próximas 6 h",
      antes: antes.api.chuvaProb6h, agora: agora.api.chuvaProb6h, delta: l.chuvaProb, formato: fmtPct, peso: 10,
      avisavel: (b) => chuvaMereceAviso(b, agora.api?.chuvaMm24h ?? 0),
      grave: (a, b) => b >= 60 && a < 60,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb24h", rotulo: "Chance de chuva nas próximas 24 h",
      antes: antes.api.chuvaProb24h, agora: agora.api.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct, peso: 12,
      avisavel: (b) => chuvaMereceAviso(b, agora.api?.chuvaMm24h ?? 0),
      grave: (a, b) => b >= 70 && a < 70,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaMm24h", rotulo: "Volume de chuva previsto em 24 h",
      antes: antes.api.chuvaMm24h, agora: agora.api.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 14,
      avisavel: (b) => chuvaMereceAviso(agora.api?.chuvaProb24h ?? 0, b),
      grave: (a, b) => b >= 5 && a < 5,
    });
    // Condição do tempo prevista (0 sol … 7 temporal): só avisa quando a
    // previsão NOVA é de tempo ruim (neblina, garoa, chuva ou tempestade).
    const gA = antes.api.gravidade;
    const gB = agora.api.gravidade;
    if (condicaoMereceAviso(gB) && Math.abs(gB - gA) >= l.gravidade) {
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

  /* ---------------------- previsão dos PRÓXIMOS DIAS (hoje e amanhã) */
  for (const [chave, a, b] of [
    ["hoje", antes.hoje, agora.hoje],
    ["amanha", antes.amanha, agora.amanha],
  ] as const) {
    if (!a || !b) continue;
    compararNumero({
      tipo: "chuva", origem: "api", chave: `${chave}.chance`, rotulo: `Chance de chuva ${chave === "hoje" ? "hoje" : "amanhã"}`,
      antes: a.chance, agora: b.chance, delta: l.chuvaProb, formato: fmtPct, peso: chave === "hoje" ? 44 : 54,
      avisavel: (y) => chuvaMereceAviso(y, b.mm),
      grave: (x, y) => y >= 70 && x < 70,
    });
  }

  /* --------------------- boletim da APPA (previsão dos próximos dias) */
  if (antes.boletim && agora.boletim && antes.boletim.fonte === agora.boletim.fonte) {
    for (const [dia, texto] of Object.entries(agora.boletim.porDia)) {
      const anterior = antes.boletim.porDia[dia];
      if (anterior === texto) continue;
      // Só avisa quando o boletim DO DIA fala de chuva, neblina ou tempestade.
      // Boletim de tempo bom (ou fora desses três): silêncio.
      if (!textoMereceAviso(texto)) continue;
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
    // O sinal de "tempo ruim" da APPA LIGANDO vira aviso — desde que o boletim
    // fale de chuva, neblina ou tempestade (o radar não vigia outro assunto);
    // desligando (a previsão ficou boa) não gera mensagem nem notificação.
    const textoMonitorado = Object.values(agora.boletim.porDia).some(textoMereceAviso);
    if (!antes.boletim.ruim && agora.boletim.ruim && textoMonitorado) {
      achadas.push({
        tipo: "boletim",
        origem: "boletim",
        rotulo: "Alerta de tempo ruim da APPA",
        antes: "desligado",
        agora: "ativo",
        frase: "a APPA marcou tempo ruim no boletim do porto",
        grave: true,
        assinatura: "boletimRuim:1",
        peso: 4,
      });
    }
  }

  /* --------------- painel da APPA (previsão das próximas horas) */
  if (antes.painel && agora.painel) {
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaProb", rotulo: "Chuva no painel da APPA (24 h)",
      antes: antes.painel.chuvaProb24h, agora: agora.painel.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct,
      peso: 60, avisavel: (b) => chuvaMereceAviso(b, agora.painel?.chuvaMm24h ?? 0),
      grave: (a, b) => b >= 70 && a < 70,
    });
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaMm", rotulo: "Volume de chuva no painel da APPA",
      antes: antes.painel.chuvaMm24h, agora: agora.painel.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 61,
      avisavel: (b) => chuvaMereceAviso(agora.painel?.chuvaProb24h ?? 0, b),
    });

    /* ----- alertas novos do painel (só chuva, neblina ou tempestade) */
    const alertasAntes = new Set((antes.painel.alertas ?? []).map(normalizarTexto));
    for (const alerta of agora.painel.alertas ?? []) {
      const chave = normalizarTexto(alerta);
      if (!chave || alertasAntes.has(chave)) continue;
      // O radar só vigia chuva, neblina e tempestade: alerta de outro assunto
      // (vento, maré, ressaca…) não vira mensagem nem notificação.
      if (!textoMereceAviso(alerta)) continue;
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
    // de previsão de chuva de verdade. A chuva SAINDO da previsão (tempo bom)
    // não vira aviso.
    const inicioA = antes.painel.inicioChuva ?? null;
    const inicioB = agora.painel.inicioChuva ?? null;
    if (inicioA !== inicioB && inicioB) {
      achadas.push({
        tipo: "chuva",
        origem: "painel",
        rotulo: "Horário da chuva no painel da APPA",
        antes: inicioA ?? "sem chuva prevista",
        agora: inicioB,
        frase: `a chuva no painel da APPA mudou de horário (${inicioA ?? "sem previsão"} → ${inicioB})`,
        grave: false,
        assinatura: `painelHoraChuva:${inicioA ?? "-"}>${inicioB}`,
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

    // Condição prevista no painel: só avisa quando a previsão NOVA é de tempo
    // ruim (garoa/chuva, chuva forte ou tempestade). Ficou bom? Silêncio.
    const gPainelA = antes.painel.gravidade ?? 0;
    const gPainelB = agora.painel.gravidade ?? 0;
    if (
      condicaoMereceAviso(gPainelB) &&
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

  /* ------------------------------------------------- ordena e deduplica */
  // Quando a API estruturada já contou a mesma história, o painel não repete:
  // ele entra como segunda opinião quando a API está fora do ar.
  const tiposDaApi = new Set(achadas.filter((m) => m.origem === "api").map((m) => m.tipo));
  return achadas
    .filter((m) => !(m.origem === "painel" && tiposDaApi.has(m.tipo)))
    .sort((a, b) => Number(b.grave) - Number(a.grave) || a.peso - b.peso);
}

/* --------------------------------------------------------- texto do aviso */
/** Texto pronto (só dados reais), usado quando a IA não responde. */
export function textoMudancaPadrao(mudancas: Mudanca[], p: Previsao | null): string {
  const principais = mudancas.slice(0, 4).map((m) => m.frase);
  const junto = mudancas.map((m) => `${m.rotulo} ${m.agora} ${m.frase}`).join(" ");
  const emoji = /tempestad|trovoad|temporal/i.test(junto)
    ? "⛈️"
    : /neblina|nevoeiro|n[eé]voa/i.test(junto)
      ? "🌫️"
      : mudancas.some((m) => m.tipo === "chuva")
        ? "🌧️"
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

const SISTEMA_RADAR = `Você avisa os caminhoneiros do Porto de Paranaguá (PR), no chat do app CopaLinks, quando a PREVISÃO traz chuva, neblina forte ou tempestade para as próximas horas ou para os próximos dias.
Regras:
- Português do Brasil, tom de colega de trabalho, claro e sem alarmismo; 2 a 4 frases; no máximo 440 caracteres; comece com um emoji do tempo.
- Use SOMENTE as mudanças e os dados fornecidos. Nunca invente número, horário ou volume de chuva.
- Diga o que a previsão traz (de → para), em que período vale e o que o motorista deve fazer na prática (lona amarrada, pista molhada e distância maior, freios, faróis acesos na neblina, atenção redobrada na tempestade).
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
 * Ciclo do radar: relê a previsão (próximas horas e próximos dias), compara
 * com o último aviso e — SOMENTE se ela trouxer chuva, neblina forte ou
 * tempestade — posta no chat + Web Push (app fechado inclusive). Previsão de
 * tempo bom não gera mensagem nem notificação (a referência avança em
 * silêncio). Nunca joga erro para cima — o cron não pode quebrar por causa do
 * clima.
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
    // O radar só vigia a previsão: sem previsão nenhuma (WRF, painel e
    // boletim), não há o que comparar — a medição do tempo atual não conta.
    if (!atual.api && !atual.painel && !atual.boletim) {
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
