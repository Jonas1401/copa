import { createHash } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, climaMudancas, configuracao } from "@/db/schema";
import { NOME_NIVEL_CHUVA, normalizarLeitura } from "@/lib/appa/analise";
import { lerPainelAppa } from "@/lib/appa/leitor";
import { parsearPainelSimport } from "@/lib/appa/painel";
import { similaridade } from "@/lib/appa/texto";
import {
  ROTULO_METODO,
  ehMetodo,
  leituraPublica,
  type LeituraAppa,
  type LeituraAppaPublica,
  type MetodoLeitura,
  type PainelSimport,
  type ResultadoLeitura,
} from "@/lib/appa/tipos";
import { notificarMensagemChat } from "@/lib/chat-push";
import { climaAgoraComposio, composioConfigurado, type ClimaComposio } from "@/lib/composio";
import { GRAVIDADE, obterPrevisao, type Previsao } from "@/lib/tempo";

// O parser do painel mora em `src/lib/appa` (todos os métodos de leitura o usam).
export { parsearPainelSimport };
export type { PainelSimport };

/**
 * RADAR DA PREVISÃO — monitor constante do tempo (SÓ servidor).
 *
 * O `/api/cron` (a cada minuto) chama `verificarMudancasPrevisao()`. O radar
 * lê a previsão do porto de novo a cada `CLIMA_MONITOR_MIN` minutos (padrão 5)
 * por dois caminhos ao mesmo tempo:
 *
 *   1. a API estruturada do SIMPORT® — Dashboard Meteoceanográfico da APPA
 *      (modelo WRF hora a hora, estação do porto, boletim e Open-Meteo), a
 *      mesma que alimenta a tela "Tempo";
 *   2. o PAINEL PÚBLICO (https://weather-appa.app.simport.com.br/), lido pelo
 *      servidor com FALLBACK AUTOMÁTICO entre vários métodos (`src/lib/appa`):
 *      API → HTML → navegador automático (Playwright) → captura de tela + OCR →
 *      Composio (método adicional). O Composio nunca é o único caminho: se ele
 *      volta vazio, o próximo método assume sem alarde. O restante do radar só
 *      enxerga a leitura NORMALIZADA (`LeituraAppa`), de qualquer método.
 *
 * Cada leitura vira um "instantâneo" (números + textos normalizados) que é
 * comparado com o instantâneo do último aviso. Mudança relevante — início de
 * chuva, chuva mais forte, chuva forte, tempestade, vento, mudança da previsão,
 * alerta novo, horário/condição previstos diferentes — o radar:
 *
 *   - posta UMA mensagem no chat dos motoristas como "📡 Radar da Previsão"
 *     (`motorista_id = 0` = sistema), no formato "🌧️ ALERTA METEOROLÓGICO":
 *     condição, horário e fonte (SIMPORT® / APPA);
 *   - dispara Web Push para todos os aparelhos: a notificação chega MESMO COM
 *     O APLICATIVO FECHADO (quem exibe é o Service Worker) e, ao tocar, abre o
 *     chat; em mudança grave (chuva forte, tempestade, alerta, rajada ≥ 40 km/h
 *     ou boletim da APPA com tempo ruim) o aviso fica na tela até o motorista tocar.
 *
 * Antispam (o radar fala só quando vale a pena):
 *   - 1ª leitura apenas registra o instantâneo, sem avisar nada antigo;
 *   - a comparação é sempre contra o ÚLTIMO AVISO, então uma mudança lenta
 *     (ex.: a chuva crescendo aos poucos) é avisada uma única vez;
 *   - mudança só de maré/horário do sol não avisa (não é alerta de tempo);
 *   - o mesmo texto lido por dois métodos (o OCR erra diferente do HTML) não
 *     vira "boletim revisado": a comparação é por semelhança;
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
/** Última leitura NORMALIZADA do painel da APPA (qualquer método). */
const CHAVE_PAINEL = "clima_monitor_painel";
const CHAVE_SEMEADO = "clima_monitor_semeado";
/** Diagnóstico da última leitura do painel: método, tentativas e log (veja `registrarLeituraPainel`). */
const CHAVE_PAINEL_DIAG = "clima_monitor_painel_diag";
/** Mudanças do painel vindas de OCR esperando a confirmação do ciclo seguinte. */
const CHAVE_OCR_PENDENTE = "clima_monitor_ocr_pendente";
/** Chave antiga (erro do Composio): só é apagada, nada mais lê. */
const CHAVE_PAINEL_ERRO = "clima_monitor_painel_erro";
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
    horasHorario: number; // horas de diferença para virar "horário previsto mudou"
  }
> = {
  baixa: { chuvaProb: 30, chuvaMm: 3, rajada: 15, vento: 15, ventoNos: 8, temp: 5, tempAgora: 6, gravidade: 3, horasHorario: 3 },
  media: { chuvaProb: 20, chuvaMm: 1, rajada: 10, vento: 10, ventoNos: 5, temp: 3, tempAgora: 4, gravidade: 2, horasHorario: 2 },
  alta: { chuvaProb: 10, chuvaMm: 0.5, rajada: 6, vento: 6, ventoNos: 3, temp: 2, tempAgora: 2, gravidade: 1, horasHorario: 1 },
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
    painelMs: numero(ambiente.CLIMA_MONITOR_PAINEL_MIN, 5) * 60_000,
    avisoMinMs: numero(ambiente.CLIMA_MONITOR_AVISO_MIN, 20) * 60_000,
    maxPorHora: numero(ambiente.CLIMA_MONITOR_MAX_HORA, 3),
  };
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
    /** Hora (HH:MM) da maior chance de chuva e da maior rajada nas próximas 24 h. */
    horaChuva?: string | null;
    horaRajada?: string | null;
  } | null;
  hoje: { max: number; min: number; chance: number; mm: number } | null;
  amanha: { max: number; min: number; chance: number; mm: number } | null;
  /** Boletim meteorológico da APPA por dia (fonte: API ou painel). */
  boletim: { fonte: "api" | "painel"; ruim: boolean; porDia: Record<string, string> } | null;
  /**
   * Painel público da APPA (leitura normalizada, de qualquer método). Os
   * números das tabelas são null quando a leitura não trouxe a tabela, para não
   * virarem "mudança" só porque o método mudou.
   */
  painel: {
    chuvaProb24h: number | null;
    chuvaMm24h: number | null;
    ventoNosMax: number | null;
    mares: string;
    sol: string;
    /** Como foi lida (instantâneos antigos não têm). */
    metodo?: MetodoLeitura;
    /** Chuva da leitura; null = sem tabela de chuva nem estação. */
    chuva?: {
      nivel: number;
      chovendo: boolean;
      forte: boolean;
      horaInicio: string | null;
      horaForte: string | null;
      /** Instantes absolutos (ms) dos mesmos horários, para comparar sem a janela de 24 h deslizar. */
      inicioMs: number | null;
      forteMs: number | null;
    } | null;
    /** Textos do boletim; null = leitura sem boletim. */
    textos?: {
      tempestade: boolean;
      tempestadeQuando: string | null;
      tempestadeTrecho: string | null;
      alertas: string[];
    } | null;
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
  | "tempestade"
  | "alerta"
  | "temperatura"
  | "condicao"
  | "boletim"
  | "mare"
  | "sol"
  | "medicao";

export type Mudanca = {
  tipo: TipoMudanca;
  /**
   * De onde veio o dado: api = WRF/estação · painel = painel da APPA lido pelo
   * servidor (qualquer método) · composio = medição do Composio (OpenWeather) ·
   * agora = estação do porto · boletim = boletim da APPA.
   */
  origem: "api" | "painel" | "composio" | "boletim" | "agora";
  rotulo: string;
  antes: string;
  agora: string;
  /** Frase pronta em português (a linha "Mudança:" do aviso). */
  frase: string;
  grave: boolean;
  /** Identidade da mudança (única por dia em `clima_mudancas`). */
  assinatura: string;
  /** Ordem de importância no aviso (menor = mais importante). */
  peso: number;
  /** "Condição:" do alerta ("chuva forte", "tempestade", "vento"…). */
  condicao?: string;
  /** "Horário:" do alerta (HH:MM, "04/10, madrugada e manhã"…), quando se sabe. */
  horario?: string | null;
  /** Informativa (maré, horário do sol): aparece na lista mas não dispara aviso sozinha. */
  secundaria?: boolean;
  /** Evento próprio do painel normalizado: não é cortado por já haver mudança da mesma família na API. */
  semDedupe?: boolean;
};

export type ResultadoRadar = {
  rodou: boolean;
  postou: boolean;
  motivo: string;
  mudancas: string[];
  /** Como o painel da APPA foi lido neste ciclo (método que funcionou ou erro). */
  painel?: { status: "sucesso" | "parcial" | "erro" | "reaproveitado"; metodo: MetodoLeitura | null };
};

/* ---------------------------------------------------------- utilidades */
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

const horaDe = (h: { hora: string }) => `${h.hora.replace(/\D/g, "").padStart(2, "0")}:00`;

function resumoHoras(p: Previsao, quantas: number) {
  const agoraMs = Date.now();
  const horas = p.horas.filter((h) => h.ts * 1000 >= agoraMs - 30 * 60_000).slice(0, quantas);
  if (!horas.length) return null;
  const pior = horas.reduce((a, h) => (GRAVIDADE[h.icone] > GRAVIDADE[a.icone] ? h : a), horas[0]);
  const chanceMax = Math.max(...horas.map((h) => h.chanceChuva));
  const rajadaMax = Math.max(...horas.map((h) => h.rajadaKmh));
  return {
    chanceMax,
    mm: r1(horas.reduce((s, h) => s + h.chuvaMm, 0)),
    rajadaMax,
    ventoMax: Math.max(...horas.map((h) => h.ventoKmh)),
    gravidade: GRAVIDADE[pior.icone],
    condicao: pior.descricao,
    horaChuva: chanceMax > 0 ? horaDe(horas.find((h) => h.chanceChuva === chanceMax) ?? horas[0]) : null,
    horaRajada: rajadaMax > 0 ? horaDe(horas.find((h) => h.rajadaKmh === rajadaMax) ?? horas[0]) : null,
  };
}

/**
 * Próxima ocorrência (ms) do horário "HH:MM" a partir de 1 h antes da leitura.
 * As tabelas do painel mostram só as próximas 24 h, então cada rótulo tem uma
 * única data possível; com ela dá para comparar "a chuva vem às 14:00" entre
 * duas leituras sem a janela deslizante enganar. (Brasília: UTC−3, sem horário de verão.)
 */
export function instanteDaHora(hhmm: string | null, em: number): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const base = em - 3_600_000;
  const dia = hojeLocal(new Date(base));
  let ms = Date.parse(`${dia}T${m[1].padStart(2, "0")}:${m[2]}:00-03:00`);
  if (Number.isNaN(ms)) return null;
  if (ms < base) ms += 86_400_000;
  return ms;
}

/** Monta a fotografia comparável a partir das fontes do radar. O painel entra pela leitura NORMALIZADA. */
export function montarInstantaneo(
  p: Previsao | null,
  painel: LeituraAppa | PainelSimport | null,
  em: number = Date.now(),
  cc: ClimaComposio | null = null,
): InstantaneoClima {
  const tem24 = p ? resumoHoras(p, 24) : null;
  const tem6 = p ? resumoHoras(p, 6) : null;
  const hoje = p?.dias[0] ?? null;
  const amanha = p?.dias[1] ?? null;

  // Painel interpretado: a leitura normalizada (qualquer método) ou, por compatibilidade, o painel já lido.
  const leitura: LeituraAppa | null = painel
    ? "metodo_leitura" in painel
      ? painel
      : normalizarLeitura({ painel, metodo: "composio", em: new Date(em) })
    : null;
  const dados: PainelSimport | null = leitura?.detalhes.painel ?? null;
  const det = leitura?.detalhes ?? null;

  const porDiaApi: Record<string, string> = {};
  for (const b of p?.boletim ?? []) if (b.texto) porDiaApi[b.data] = normalizarTexto(b.texto);
  const porDiaPainel: Record<string, string> = {};
  for (const b of dados?.boletim ?? []) if (b.texto) porDiaPainel[b.dia] = normalizarTexto(b.texto);
  const temApi = Object.keys(porDiaApi).length > 0;
  const temPainel = Object.keys(porDiaPainel).length > 0;

  const agoraPainel = dados?.agora ?? null;
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

  const temTabelas = Boolean(dados && (dados.chuva.length || dados.vento.length));
  const painelSnap: InstantaneoClima["painel"] =
    leitura && dados && det && (temTabelas || dados.mares.length || temPainel || leitura.alertas.length)
      ? {
          chuvaProb24h: dados.chuva.length ? Math.max(0, ...dados.chuva.map((c) => c.prob)) : null,
          chuvaMm24h: dados.chuva.length ? r1(dados.chuva.reduce((s, c) => s + c.mm, 0)) : null,
          ventoNosMax: dados.vento.length ? r1(Math.max(0, ...dados.vento.map((v) => v.nos))) : null,
          mares: dados.mares
            .map((m) => `${m.hora} ${r1(m.altura).toString().replace(".", ",")}m ${m.tipo}`)
            .join("; "),
          sol: [dados.nascerSol, dados.porSol].filter(Boolean).join("/") || "-",
          metodo: leitura.metodo_leitura,
          chuva:
            dados.chuva.length || det.chuva.chovendoAgora
              ? {
                  nivel: det.chuva.nivelMax,
                  chovendo: det.chuva.chovendoAgora,
                  forte: det.chuvaForte.prevista || det.chuva.nivelMax >= 3,
                  horaInicio: det.chuva.horaInicio,
                  horaForte: det.chuva.horaForte,
                  inicioMs: instanteDaHora(det.chuva.horaInicio, em),
                  forteMs: instanteDaHora(det.chuva.horaForte, em),
                }
              : null,
          textos:
            temPainel || leitura.alertas.length
              ? {
                  tempestade: det.tempestade.prevista,
                  tempestadeQuando: det.tempestade.horario,
                  tempestadeTrecho: det.tempestade.trecho,
                  alertas: leitura.alertas.slice(0, 6),
                }
              : null,
        }
      : null;

  return {
    em,
    fontes: {
      simport: Boolean(p?.fontes.simport),
      estacao: Boolean(p?.fontes.estacao),
      openMeteo: Boolean(p?.fontes.openMeteo),
      composio: Boolean(p?.fontes.composio),
      painel: Boolean(dados && (dados.chuva.length || dados.vento.length || temPainel)),
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
            horaChuva: tem24.horaChuva,
            horaRajada: tem24.horaRajada,
          }
        : null,
    hoje: hoje ? { max: hoje.max, min: hoje.min, chance: hoje.chanceChuva, mm: hoje.chuvaMm } : null,
    amanha: amanha ? { max: amanha.max, min: amanha.min, chance: amanha.chanceChuva, mm: amanha.chuvaMm } : null,
    boletim: temApi
      ? { fonte: "api", ruim: Boolean(p?.boletim.some((b) => b.tempoRuim)), porDia: porDiaApi }
      : temPainel
        ? { fonte: "painel", ruim: false, porDia: porDiaPainel }
        : null,
    painel: painelSnap,
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
/** Texto sem marcas HTML (o boletim da APPA traz `<strong>Atenção</strong>`). */
const semTags = (t: string) => t.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
/** Boletim que fala de fenômeno forte: um dia novo assim não é "só mais um dia". */
const TEXTO_SEVERO = /tempestade|trovoada|temporal|raios|chuvas?\s+(?:muito\s+)?(?:fortes?|intensas?)|rajadas|ventos?\s+fortes?|aten[çc][ãa]o\s*:|alerta\s*:/i;

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
    condicao?: string;
    horario?: string | null;
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
      condicao: opcoes.condicao,
      horario: opcoes.horario,
    });
  }

  /* ------------------------------------- previsão WRF (API estruturada) */
  if (antes.api && agora.api) {
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb6h", rotulo: "Chance de chuva nas próximas 6 h",
      antes: antes.api.chuvaProb6h, agora: agora.api.chuvaProb6h, delta: l.chuvaProb, formato: fmtPct, peso: 10,
      grave: (a, b) => b >= 60 && a < 60,
      condicao: "chuva", horario: agora.api.horaChuva,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaProb24h", rotulo: "Chance de chuva nas próximas 24 h",
      antes: antes.api.chuvaProb24h, agora: agora.api.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct, peso: 12,
      grave: (a, b) => b >= 70 && a < 70,
      condicao: "chuva", horario: agora.api.horaChuva,
    });
    compararNumero({
      tipo: "chuva", origem: "api", chave: "chuvaMm24h", rotulo: "Volume de chuva previsto em 24 h",
      antes: antes.api.chuvaMm24h, agora: agora.api.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 14,
      grave: (a, b) => b >= 5 && a < 5,
      condicao: "chuva", horario: agora.api.horaChuva,
    });
    compararNumero({
      tipo: "vento", origem: "api", chave: "rajadaMax", rotulo: "Rajada máxima prevista em 24 h",
      antes: antes.api.rajadaMax, agora: agora.api.rajadaMax, delta: l.rajada, formato: fmtKm, peso: 20,
      grave: (a, b) => b >= 40 && a < 40,
      condicao: "vento", horario: agora.api.horaRajada,
    });
    compararNumero({
      tipo: "vento", origem: "api", chave: "ventoMax", rotulo: "Vento máximo previsto em 24 h",
      antes: antes.api.ventoMax, agora: agora.api.ventoMax, delta: l.vento, formato: fmtKm, peso: 22,
      grave: (a, b) => b >= 30 && a < 30,
      condicao: "vento", horario: agora.api.horaRajada,
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
        condicao: agora.api.condicao.toLowerCase(),
        horario: gB >= GRAVIDADE.chuva ? agora.api.horaChuva : null,
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
    // O mesmo texto lido por métodos diferentes (ou por OCR) nunca sai idêntico: nesses casos compara por semelhança.
    const ocr = antes.painel?.metodo === "ocr" || agora.painel?.metodo === "ocr";
    const tolerante = agora.boletim.fonte === "painel" && (ocr || antes.painel?.metodo !== agora.painel?.metodo);
    for (const [dia, texto] of Object.entries(agora.boletim.porDia)) {
      const anterior = antes.boletim.porDia[dia];
      if (anterior === texto) continue;
      if (anterior != null && tolerante && similaridade(anterior, texto) >= (ocr ? 0.7 : 0.85)) continue;
      const novo = anterior == null;
      const severo = TEXTO_SEVERO.test(texto);
      achadas.push({
        tipo: "boletim",
        origem: "boletim",
        rotulo: `Boletim da APPA (${dia})`,
        antes: novo ? "—" : semTags(anterior).slice(0, 120),
        agora: semTags(texto).slice(0, 200),
        frase: novo
          ? `boletim da APPA publicado para ${dia}: ${semTags(texto).slice(0, 180)}`
          : `boletim da APPA revisado para ${dia}: ${semTags(texto).slice(0, 180)}`,
        grave: agora.boletim.ruim,
        assinatura: `boletim:${dia}:${curtas8(texto)}`,
        peso: novo ? 5 : 6,
        condicao: agora.boletim.ruim ? "alerta de tempo ruim" : "previsão do boletim alterada",
        horario: dia,
        // Um dia que só entrou na janela do boletim (a cada dia entra um) não é mudança de previsão.
        secundaria: novo && !agora.boletim.ruim && !severo,
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
        condicao: "alerta de tempo ruim",
      });
    }
  }

  /* ------------------------ painel público da APPA (leitura normalizada) */
  if (antes.painel && agora.painel) {
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaProb", rotulo: "Chuva no painel da APPA (24 h)",
      antes: antes.painel.chuvaProb24h, agora: agora.painel.chuvaProb24h, delta: l.chuvaProb, formato: fmtPct,
      peso: 60, grave: (a, b) => b >= 70 && a < 70, condicao: "chuva", horario: agora.painel.chuva?.horaInicio,
    });
    compararNumero({
      tipo: "chuva", origem: "painel", chave: "painel.chuvaMm", rotulo: "Volume de chuva no painel da APPA",
      antes: antes.painel.chuvaMm24h, agora: agora.painel.chuvaMm24h, delta: l.chuvaMm, formato: fmtMm, peso: 61,
      condicao: "chuva", horario: agora.painel.chuva?.horaInicio,
    });
    compararNumero({
      tipo: "vento", origem: "painel", chave: "painel.vento", rotulo: "Vento no painel da APPA (24 h)",
      antes: antes.painel.ventoNosMax, agora: agora.painel.ventoNosMax, delta: l.ventoNos, formato: fmtNos,
      peso: 62, grave: (a, b) => b >= 25 && a < 25, condicao: "vento",
    });
    // Maré e horário do sol são informativos (a tábua desliza a cada maré e o sol muda 1 min por dia): só avisam junto de um alerta de tempo.
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
        secundaria: true,
      });
    }
    if (antes.painel.sol && agora.painel.sol && antes.painel.sol !== "-" && agora.painel.sol !== "-" && antes.painel.sol !== agora.painel.sol) {
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
        secundaria: true,
      });
    }

    /* ---- eventos do painel normalizado: chuva, tempestade, alertas e horários */
    const ca = antes.painel.chuva;
    const cb = agora.painel.chuva;
    if (ca && cb) {
      const nome = (n: number) => NOME_NIVEL_CHUVA[Math.min(Math.max(n, 0), 3)];
      const aguardar = l.horasHorario * 3_600_000;
      if (!ca.forte && cb.forte) {
        achadas.push({
          tipo: "chuva", origem: "painel", semDedupe: true,
          rotulo: "Chuva forte prevista",
          antes: nome(ca.nivel), agora: "chuva forte",
          frase: `chuva forte prevista${cb.horaForte ? ` para as ${cb.horaForte}` : ""}`,
          grave: true, assinatura: "chuvaForte:1", peso: 2,
          condicao: "chuva forte", horario: cb.horaForte ?? cb.horaInicio,
        });
      } else if (cb.nivel > ca.nivel && (sensibilidade !== "baixa" || cb.nivel >= 2)) {
        achadas.push({
          tipo: "chuva", origem: "painel", semDedupe: true,
          rotulo: "Intensidade da chuva",
          antes: nome(ca.nivel), agora: nome(cb.nivel),
          frase: `a intensidade da chuva prevista subiu de ${ca.nivel ? nome(ca.nivel) : "sem chuva"} para ${nome(cb.nivel)}`,
          grave: false, assinatura: `chuvaNivel:${ca.nivel}>${cb.nivel}`, peso: 7,
          condicao: nome(cb.nivel), horario: cb.horaForte ?? cb.horaInicio,
        });
      }
      if (!ca.chovendo && cb.chovendo) {
        achadas.push({
          tipo: "chuva", origem: "painel", semDedupe: true,
          rotulo: "Início de chuva",
          antes: "sem chuva", agora: nome(Math.max(1, cb.nivel)),
          frase: "começou a chover no porto",
          grave: false, assinatura: "chuvaInicio:1", peso: 8,
          condicao: "chuva", horario: cb.horaInicio,
        });
      } else if (!ca.chovendo && !cb.chovendo && ca.horaInicio == null && cb.horaInicio != null) {
        achadas.push({
          tipo: "chuva", origem: "painel", semDedupe: true,
          rotulo: "Chuva passou a ser prevista",
          antes: "sem chuva prevista", agora: `a partir das ${cb.horaInicio}`,
          frase: `passou a ser prevista chuva a partir das ${cb.horaInicio}`,
          grave: false, assinatura: `chuvaPrevista:${cb.horaInicio}`, peso: 9,
          condicao: "chuva", horario: cb.horaInicio,
        });
      }
      // Horário previsto mudou (compara instantes absolutos: a janela de 24 h do painel desliza com o tempo).
      for (const [campo, rotuloH, a, b, ab, bb] of [
        ["horaInicio", "início da chuva", ca.horaInicio, cb.horaInicio, ca.inicioMs, cb.inicioMs],
        ["horaForte", "chuva forte", ca.horaForte, cb.horaForte, ca.forteMs, cb.forteMs],
      ] as const) {
        if (!a || !b || ab == null || bb == null) continue;
        if (ab <= agora.em || ca.chovendo) continue; // o horário antigo já passou: não é "horário alterado"
        if (Math.abs(bb - ab) < aguardar) continue;
        achadas.push({
          tipo: "chuva", origem: "painel", semDedupe: true,
          rotulo: `Horário previsto (${rotuloH})`,
          antes: a, agora: b,
          frase: `o horário previsto para ${rotuloH} mudou de ${a} para ${b}`,
          grave: false, assinatura: `${campo}:${a}>${b}`, peso: 16,
          condicao: campo === "horaForte" ? "chuva forte" : "chuva", horario: b,
        });
      }
    }

    const ta = antes.painel.textos;
    const tb = agora.painel.textos;
    if (ta && tb) {
      let tempestadeNova = false;
      if (!ta.tempestade && tb.tempestade) {
        tempestadeNova = true;
        achadas.push({
          tipo: "tempestade", origem: "painel", semDedupe: true,
          rotulo: "Possibilidade de tempestade",
          antes: "sem tempestade prevista", agora: semTags(tb.tempestadeTrecho ?? "tempestade prevista").slice(0, 160),
          frase: `possibilidade de tempestade${tb.tempestadeQuando ? ` (${tb.tempestadeQuando})` : ""}`,
          grave: true, assinatura: "tempestade:1", peso: 1,
          condicao: "tempestade", horario: tb.tempestadeQuando,
        });
      }
      for (const alerta of tb.alertas) {
        if (ta.alertas.some((x) => similaridade(x, alerta) >= 0.8)) continue;
        // A tempestade nova já conta a mesma história que o alerta do boletim.
        if (tempestadeNova && tb.tempestadeTrecho && alerta.includes(tb.tempestadeTrecho.slice(0, 40))) continue;
        achadas.push({
          tipo: "alerta", origem: "painel", semDedupe: true,
          rotulo: "Novo alerta meteorológico",
          antes: "—", agora: semTags(alerta).slice(0, 200),
          frase: `novo alerta meteorológico: ${semTags(alerta).slice(0, 180)}`,
          grave: true, assinatura: `alerta:${curtas8(normalizarTexto(alerta))}`, peso: 3,
          condicao: "alerta meteorológico", horario: alerta.match(/^\d{1,2}\/\d{1,2}/)?.[0] ?? null,
        });
      }
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
    .filter((m) => m.semDedupe || !((m.origem === "painel" || m.origem === "composio") && tiposDaApi.has(m.tipo)))
    .sort((a, b) => Number(b.grave) - Number(a.grave) || a.peso - b.peso);
}

/* --------------------------------------------------------- texto do aviso */
const FONTE_AVISO = "SIMPORT® / APPA";

/** Primeira letra maiúscula (as frases das mudanças começam minúsculas). */
const maiuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** "Condição:" de uma mudança ("chuva forte", "tempestade", "vento"…). */
export function condicaoDaMudanca(m: Mudanca): string {
  if (m.condicao) return m.condicao;
  switch (m.tipo) {
    case "tempestade":
      return "tempestade";
    case "chuva":
      return "chuva";
    case "vento":
      return "vento";
    case "alerta":
      return "alerta meteorológico";
    case "boletim":
      return m.grave ? "alerta de tempo ruim" : "previsão do boletim alterada";
    case "condicao":
      return m.agora.toLowerCase();
    default:
      return "previsão alterada";
  }
}

/** Emoji do alerta: tempestade, chuva, vento ou aviso geral. */
export function emojiDoAlerta(mudancas: Mudanca[]): string {
  if (mudancas.some((m) => m.tipo === "tempestade")) return "⛈️";
  if (mudancas.some((m) => m.tipo === "chuva" || /chuva/.test(condicaoDaMudanca(m)))) return "🌧️";
  if (mudancas.some((m) => m.tipo === "vento")) return "💨";
  return "⚠️";
}

/** Família da condição ("chuva forte" e "chuva" são a mesma: chuva). */
const familiaDaCondicao = (c: string) => c.split(" ")[0];

/**
 * Condição e horário que abrem o aviso. A mudança mais importante manda e, de
 * cada família (chuva, vento, tempestade…), vale só a condição mais forte:
 * "chuva forte + vento", nunca "chuva forte + chuva".
 */
export function resumoDoAlerta(mudancas: Mudanca[]): { condicao: string; horario: string | null } {
  const porFamilia = new Map<string, string>();
  for (const m of mudancas.slice(0, 6)) {
    const c = condicaoDaMudanca(m);
    if (!porFamilia.has(familiaDaCondicao(c))) porFamilia.set(familiaDaCondicao(c), c);
  }
  return {
    condicao: [...porFamilia.values()].slice(0, 3).join(" + ") || "previsão alterada",
    horario: mudancas.find((m) => m.horario)?.horario ?? null,
  };
}

/**
 * Texto do aviso (só dados reais), no formato do alerta meteorológico:
 *
 *   🌧️ ALERTA METEOROLÓGICO
 *
 *   Foi identificada uma mudança na previsão meteorológica da região do Porto de Paranaguá.
 *
 *   Condição: chuva forte
 *   Horário: 14:30
 *
 *   Fonte: SIMPORT® / APPA
 *
 * Entre o horário e a fonte entram até 2 linhas "Mudança:" com o de → para real.
 */
export function textoAlertaMeteorologico(mudancas: Mudanca[], _p: Previsao | null = null): string {
  const { condicao, horario } = resumoDoAlerta(mudancas);
  // Uma linha "Mudança:" por família (a 1ª de cada), no máximo duas.
  const vistas = new Set<string>();
  const detalhes: string[] = [];
  for (const m of mudancas) {
    const f = familiaDaCondicao(condicaoDaMudanca(m));
    if (vistas.has(f) || detalhes.length >= 2) continue;
    vistas.add(f);
    detalhes.push(`Mudança: ${maiuscula(semTags(m.frase))}`);
  }
  return [
    `${emojiDoAlerta(mudancas)} ALERTA METEOROLÓGICO`,
    "",
    "Foi identificada uma mudança na previsão meteorológica da região do Porto de Paranaguá.",
    "",
    `Condição: ${condicao}`,
    ...(horario ? [`Horário: ${horario}`] : []),
    ...detalhes.map((d) => d.slice(0, 150)),
    "",
    `Fonte: ${FONTE_AVISO}`,
  ].join("\n");
}

/** Nome antigo do texto padrão do aviso (agora é o alerta meteorológico acima). */
export const textoMudancaPadrao = textoAlertaMeteorologico;

/** Título e corpo curtos da notificação (o Android corta textos longos). */
export function notificacaoDoAlerta(mudancas: Mudanca[]): { titulo: string; corpo: string } {
  const { condicao, horario } = resumoDoAlerta(mudancas);
  return {
    titulo: `${emojiDoAlerta(mudancas)} ALERTA METEOROLÓGICO`,
    corpo: [
      "Mudança na previsão do Porto de Paranaguá.",
      `Condição: ${condicao}`,
      ...(horario ? [`Horário: ${horario}`] : []),
      `Fonte: ${FONTE_AVISO}`,
    ].join("\n"),
  };
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

/**
 * O OCR é o método que mais erra um dígito ("0.4" por "6.4"). Por isso uma
 * mudança do PAINEL vinda de uma leitura por OCR só avisa quando o MESMO
 * conjunto de mudanças aparece em dois ciclos seguidos; no 1º ciclo ela fica
 * pendente (a chave guarda as assinaturas). Mudanças da API e dos outros
 * métodos nunca esperam.
 */
export function confirmarPorOcr(
  mudancas: Mudanca[],
  metodo: MetodoLeitura | null,
  pendente: string | null,
): { liberadas: Mudanca[]; pendente: string | null; seguradas: number } {
  const doPainel = metodo === "ocr" ? mudancas.filter((m) => m.origem === "painel") : [];
  if (!doPainel.length) return { liberadas: mudancas, pendente: null, seguradas: 0 };
  const chave = doPainel.map((m) => m.assinatura).sort().join("|");
  if (pendente === chave) return { liberadas: mudancas, pendente: null, seguradas: 0 };
  return { liberadas: mudancas.filter((m) => m.origem !== "painel"), pendente: chave, seguradas: doPainel.length };
}

/**
 * Preenche as lacunas da referência (o instantâneo do último aviso) com as
 * fontes que ela não tinha — ex.: o painel só passou a ser lido agora, ou o
 * instantâneo é de antes dos blocos de chuva/tempestade/alertas. Sem isso a
 * fonte nova nunca seria comparada, pois a referência só muda quando há aviso.
 * Preencher lacuna nunca esconde mudança: não havia com o que comparar.
 */
export function completarReferencia(
  anterior: InstantaneoClima,
  atual: InstantaneoClima,
): { referencia: InstantaneoClima; completou: boolean } {
  const ref: InstantaneoClima = { ...anterior, painel: anterior.painel ? { ...anterior.painel } : null };
  let completou = false;
  for (const k of ["api", "hoje", "amanha", "boletim", "painel", "agora", "composioAgora"] as const) {
    if (ref[k] == null && atual[k] != null) {
      (ref as Record<string, unknown>)[k] = atual[k];
      completou = true;
    }
  }
  if (ref.painel && atual.painel) {
    if (ref.painel.chuva === undefined && atual.painel.chuva !== undefined) {
      ref.painel.chuva = atual.painel.chuva;
      ref.painel.metodo ??= atual.painel.metodo;
      completou = true;
    }
    if (ref.painel.textos === undefined && atual.painel.textos !== undefined) {
      ref.painel.textos = atual.painel.textos;
      completou = true;
    }
  }
  if (completou) ref.fontes = { ...ref.fontes, ...atual.fontes };
  return { referencia: ref, completou };
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

/* ------------------------------------- painel da APPA (vários métodos) */
type PainelGuardado = { em: number; leitura: LeituraAppa };

/** Última leitura guardada no banco (aceita o formato antigo `{ em, dados }`, que era só do Composio). */
export function painelGuardado(bruto: string | null): PainelGuardado | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as { em?: number; leitura?: LeituraAppa; dados?: PainelSimport };
    if (typeof j?.em !== "number") return null;
    if (j.leitura?.detalhes?.painel) return { em: j.em, leitura: j.leitura };
    if (j.dados) {
      return { em: j.em, leitura: normalizarLeitura({ painel: j.dados, metodo: "composio", em: new Date(j.em) }) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Diagnóstico da última leitura do painel + log rolante das tentativas (item "log de diagnóstico"). */
export type DiagnosticoPainel = {
  em: number;
  status: "sucesso" | "parcial" | "erro";
  metodo: MetodoLeitura | null;
  /** Só existe quando TODOS os métodos falharam na última leitura. */
  erro: string | null;
  duracaoMs: number;
  tentativas: { ordem: number; metodo: MetodoLeitura; resultado: string; duracaoMs: number; detalhe: string }[];
  /** Últimas linhas do log: "[09:15:02] APPA · #1 API · SUCESSO · 812 ms · …". */
  log: string[];
  /** Resumo das últimas leituras (uma por ciclo), da mais antiga para a mais nova. */
  historico: { em: string; metodo: MetodoLeitura | null; status: "sucesso" | "parcial" | "erro"; resumo: string }[];
};

const MAX_LINHAS_LOG = 60;
const MAX_HISTORICO = 24;

export function diagnosticoValido(bruto: string | null): DiagnosticoPainel | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as DiagnosticoPainel;
    if (typeof j?.em !== "number" || !Array.isArray(j?.log)) return null;
    return { ...j, historico: Array.isArray(j.historico) ? j.historico : [] };
  } catch {
    return null;
  }
}

/** Grava a leitura (formato normalizado), o diagnóstico e o log da tentativa. Nunca joga erro. */
export async function registrarLeituraPainel(r: ResultadoLeitura): Promise<void> {
  try {
    const agora = Date.now();
    const anterior = diagnosticoValido(await lerConfig(CHAVE_PAINEL_DIAG).catch(() => null));
    // Caminho leve (app aberto) que falhou: só API e HTML foram tentados, então isto NÃO é "todos os
    // métodos falharam". O log registra, mas o estado da tela só muda no ciclo completo do cron.
    if (r.leve && r.status === "erro" && anterior) {
      const log = [...anterior.log, ...r.tentativas.map((t) => t.linha)].slice(-MAX_LINHAS_LOG);
      await gravarConfig(CHAVE_PAINEL_DIAG, JSON.stringify({ ...anterior, log }));
      return;
    }
    const resumo = r.leitura
      ? [r.leitura.temperatura, r.leitura.chuva, r.leitura.vento?.split(" · ")[0]].filter(Boolean).join(" · ")
      : (r.erro ?? "sem leitura").slice(0, 160);
    const diag: DiagnosticoPainel = {
      em: agora,
      status: r.status,
      metodo: r.metodo,
      erro: r.status === "erro" ? r.erro : null,
      duracaoMs: r.duracaoMs,
      tentativas: r.tentativas.map((t) => ({
        ordem: t.ordem,
        metodo: t.metodo,
        resultado: t.resultado,
        duracaoMs: t.duracaoMs,
        detalhe: t.detalhe.slice(0, 240),
      })),
      log: [...(anterior?.log ?? []), ...r.tentativas.map((t) => t.linha)].slice(-MAX_LINHAS_LOG),
      historico: [
        ...(anterior?.historico ?? []),
        { em: new Date(agora).toISOString(), metodo: r.metodo, status: r.status, resumo },
      ].slice(-MAX_HISTORICO),
    };
    await gravarConfig(CHAVE_PAINEL_DIAG, JSON.stringify(diag));
    if (r.leitura) await gravarConfig(CHAVE_PAINEL, JSON.stringify({ em: agora, leitura: r.leitura }));
    // Chave do tempo em que só o Composio lia o painel: não é mais usada.
    await db.delete(configuracao).where(eq(configuracao.chave, CHAVE_PAINEL_ERRO)).catch(() => null);
  } catch {
    /* o diagnóstico nunca pode derrubar o radar */
  }
}

/** Folga para a leitura do ciclo seguinte não cair no cache por poucos segundos de diferença. */
const FOLGA_CICLO_MS = 20_000;

/**
 * Painel da APPA, lido pelo servidor com fallback automático entre os métodos
 * (API → HTML → navegador → OCR → Composio) e devolvido no FORMATO NORMALIZADO.
 * Relido a cada ciclo do radar (`CLIMA_MONITOR_PAINEL_MIN`, padrão 5 min); no
 * caminho do app aberto (`suave`) só usa os métodos rápidos. Devolve null só
 * quando TODOS os métodos falham agora — o radar segue com a API da previsão.
 */
export async function lerPainel(
  cfg: ConfigRadar,
  opcoes: boolean | { forcar?: boolean; suave?: boolean } = {},
): Promise<LeituraAppa | null> {
  const o = typeof opcoes === "boolean" ? { forcar: opcoes } : opcoes;
  try {
    const guardado = painelGuardado(await lerConfig(CHAVE_PAINEL).catch(() => null));
    if (!o.forcar && guardado && Date.now() - guardado.em < Math.max(0, cfg.painelMs - FOLGA_CICLO_MS)) {
      return guardado.leitura;
    }
    const r = await lerPainelAppa({ leve: o.suave });
    await registrarLeituraPainel(r);
    return r.leitura;
  } catch {
    return null;
  }
}

/**
 * Lê o painel AGORA por todos os métodos (botão "Ler painel agora" do
 * administrador): registra leitura e log, mas não compara nem avisa ninguém.
 */
export async function lerPainelAgora(): Promise<ResultadoLeitura> {
  const r = await lerPainelAppa({});
  await registrarLeituraPainel(r);
  return r;
}

/** Guarda (ou limpa) o motivo da última falha de uma fonte do radar. */
async function gravarDiagnostico(chave: string, motivo: string | null) {
  if (!motivo) {
    await db.delete(configuracao).where(eq(configuracao.chave, chave));
    return;
  }
  await gravarConfig(chave, motivo.slice(0, 200));
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

    // As três leituras são independentes: rodam juntas (o tempo do ciclo é o da mais lenta).
    const [p, painel, cc] = await Promise.all([
      lerPrevisao(opcoes.previsao, opcoes.suave),
      lerPainel(cfg, { forcar: opcoes.forcar, suave: opcoes.suave }),
      // Segunda opinião: medição do tempo atual PELO COMPOSIO (OpenWeather).
      lerComposioAgora(opcoes.forcar),
    ]);
    const leituraPainel: ResultadoRadar["painel"] = painel
      ? { status: painel.status, metodo: painel.metodo_leitura }
      : { status: "erro", metodo: null };
    if (!p && !painel && !cc) {
      return { rodou: true, postou: false, motivo: "fontes do tempo indisponíveis", mudancas: [], painel: leituraPainel };
    }
    const atual = montarInstantaneo(p, painel, Date.now(), cc);
    if (!atual.api && !atual.painel && !atual.boletim && !atual.agora && !atual.composioAgora) {
      return { rodou: true, postou: false, motivo: "leitura incompleta", mudancas: [], painel: leituraPainel };
    }

    const guardado = await lerInstantaneo();
    if (!guardado) {
      // 1ª leitura: registra o que já existe e não avisa coisa antiga.
      await gravarInstantaneo(atual);
      if (!(await lerConfig(CHAVE_SEMEADO))) await gravarConfig(CHAVE_SEMEADO, new Date().toISOString());
      return { rodou: true, postou: false, motivo: "primeira leitura registrada", mudancas: [], painel: leituraPainel };
    }

    // Fonte que não existia na referência (ex.: o painel só passou a ser lido agora) entra nela, para poder ser comparada depois.
    const { referencia: anterior, completou } = completarReferencia(guardado, atual);
    // Maré e horário do sol só informam: sozinhos não são alerta de tempo.
    const relevantes = detectarMudancas(anterior, atual, cfg.sensibilidade).filter((m) => !m.secundaria);
    // Leitura por OCR erra dígito: a mudança do painel só vale se se repetir no ciclo seguinte.
    const pendente = await lerConfig(CHAVE_OCR_PENDENTE).catch(() => null);
    const conf = confirmarPorOcr(relevantes, painel?.metodo_leitura ?? null, pendente);
    if (conf.pendente !== pendente) {
      await (conf.pendente
        ? gravarConfig(CHAVE_OCR_PENDENTE, conf.pendente)
        : db.delete(configuracao).where(eq(configuracao.chave, CHAVE_OCR_PENDENTE))
      ).catch(() => null);
    }
    const mudancas = conf.liberadas;
    // Sem mudança: mantém o instantâneo do último aviso como referência, para
    // uma mudança lenta (chuva crescendo aos poucos) ser avisada uma vez só.
    if (!mudancas.length) {
      if (completou) await gravarInstantaneo(anterior);
      return {
        rodou: true,
        postou: false,
        motivo: conf.seguradas ? "mudança lida por OCR: aguardando confirmação no próximo ciclo" : "previsão sem mudança",
        mudancas: [],
        painel: leituraPainel,
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
        painel: leituraPainel,
      };
    }

    const bloqueio = opcoes.forcar ? null : await limiteDeAvisos(cfg);
    if (bloqueio) {
      return { rodou: true, postou: false, motivo: bloqueio, mudancas: mudancas.map((m) => m.rotulo), painel: leituraPainel };
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
      return { rodou: true, postou: false, motivo: "mudanças já avisadas hoje", mudancas: [], painel: leituraPainel };
    }

    const grave = novas.some((m) => m.grave);
    // Texto fixo no formato "ALERTA METEOROLÓGICO" (condição, horário e fonte): só dados reais, sem IA no meio.
    const texto = textoAlertaMeteorologico(novas, p);
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
        { requireInteraction: grave, notificacao: notificacaoDoAlerta(novas) },
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
      painel: leituraPainel,
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
export type SituacaoPainel = "conectado" | "leitura-realizada" | "erro" | "aguardando";

export type StatusPainelApp = {
  /** Última leitura bem-sucedida (ISO). */
  em: string | null;
  /** Só preenchido quando TODOS os métodos falharam na última tentativa. */
  erro: string | null;
  situacao: SituacaoPainel;
  /** Texto pronto da tela: "Painel APPA: conectado" · "Painel APPA: leitura realizada" · … */
  rotulo: string;
  metodo: MetodoLeitura | null;
  /** "API" · "HTML direto" · "Navegador automático" · "OCR" · "Composio". */
  metodoRotulo: string | null;
  /** Quando foi a última tentativa de leitura (ISO), com sucesso ou não. */
  tentativaEm: string | null;
  /** A última leitura trouxe só parte dos dados (ex.: só o tempo de agora). */
  parcial: boolean;
  /** Log de diagnóstico: uma linha por tentativa de cada método (as mais recentes). */
  log: string[];
  /** Última leitura no formato normalizado (sem os detalhes internos). */
  leitura: LeituraAppaPublica | null;
};

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
  /** Leitura do painel da APPA (vários métodos): como foi lida, quando e o log. */
  painel: StatusPainelApp;
  /** Último erro ao ler a medição do tempo pelo Composio (null = tudo certo). */
  composioErro: string | null;
};

const ROTULO_SITUACAO: Record<SituacaoPainel, string> = {
  conectado: "Painel APPA: conectado",
  "leitura-realizada": "Painel APPA: leitura realizada",
  erro: "Painel APPA: sem leitura",
  aguardando: "Painel APPA: aguardando a primeira leitura",
};

/** Situação do painel a partir do que está guardado (puro: usado pela tela e pelos testes). */
export function statusDoPainel(
  guardado: PainelGuardado | null,
  diag: DiagnosticoPainel | null,
): StatusPainelApp {
  const lido = guardado?.leitura ?? null;
  // Erro só quando a ÚLTIMA tentativa falhou em todos os métodos.
  const falhou = diag?.status === "erro";
  const metodo = falhou ? null : ((diag?.metodo && ehMetodo(diag.metodo) ? diag.metodo : null) ?? lido?.metodo_leitura ?? null);
  const situacao: SituacaoPainel = falhou
    ? "erro"
    : lido || diag?.status === "sucesso" || diag?.status === "parcial"
      ? metodo === "api"
        ? "conectado"
        : "leitura-realizada"
      : "aguardando";
  return {
    em: guardado ? new Date(guardado.em).toISOString() : null,
    erro: falhou ? (diag?.erro ?? "nenhum método conseguiu ler o painel") : null,
    situacao,
    rotulo: ROTULO_SITUACAO[situacao],
    metodo,
    metodoRotulo: metodo ? ROTULO_METODO[metodo] : null,
    tentativaEm: diag ? new Date(diag.em).toISOString() : null,
    parcial: !falhou && (diag?.status === "parcial" || lido?.status === "parcial"),
    log: (diag?.log ?? []).slice(-24),
    leitura: lido ? leituraPublica(lido) : null,
  };
}

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
    painel: statusDoPainel(null, null),
    composioErro: null,
  };
  try {
    const [ultima, instantaneo, [mudanca], [total], composio, painelBruto, diagBruto, erroComposio] = await Promise.all([
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
      lerConfig(CHAVE_PAINEL_DIAG),
      lerConfig(CHAVE_COMPOSIO_ERRO),
    ]);
    const painel = statusDoPainel(painelGuardado(painelBruto), diagnosticoValido(diagBruto));
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
        // O painel vale pelo diagnóstico da última leitura (a referência do último aviso pode ser antiga).
        painel: painel.situacao === "conectado" || painel.situacao === "leitura-realizada",
        composio: Boolean(instantaneo?.fontes.composio),
      },
      composio,
      painel,
      composioErro: erroComposio ?? null,
    };
  } catch {
    return padrao;
  }
}
