/**
 * Previsão do tempo de Paranaguá.
 *
 * Fonte principal: SIMPORT® — Dashboard Meteoceanográfico da APPA
 * (https://weather-appa.app.simport.com.br/), a mesma API que o painel usa:
 *   - previsão hora a hora do modelo WRF (≈3 dias à frente);
 *   - estação meteorológica do porto (medição a cada 5 minutos);
 *   - boletim meteorológico da APPA.
 * Os dias além do alcance do WRF vêm da Open-Meteo, para fechar os 15 dias.
 *
 * Tudo roda só no servidor: o token da Simport nunca vai para o navegador.
 */

import {
  APPA_BOLETIM_API as SIMPORT_BOLETIM,
  APPA_DADOS_API as SIMPORT_DADOS,
  APPA_TOKEN as SIMPORT_TOKEN,
} from "@/lib/appa-painel-texto";

const LOCAL = { cidade: "Paranaguá", uf: "PR", lat: -25.5161, lon: -48.5225 };
const FUSO = "America/Sao_Paulo";
const NOS_PARA_KMH = 1.852; // a APPA mede vento em nós
const VIDA_CACHE = 10 * 60 * 1000;

/* -------------------------------------------------------------- tipos */
export type Icone =
  | "sol"
  | "lua"
  | "sol-nuvem"
  | "lua-nuvem"
  | "nuvem"
  | "neblina"
  | "garoa"
  | "chuva"
  | "chuva-forte"
  | "tempestade";

export type Hora = {
  ts: number; // segundos
  hora: string; // "14h"
  dia: string; // "2026-09-23"
  temperatura: number;
  sensacao: number;
  umidade: number;
  chanceChuva: number;
  chuvaMm: number;
  ventoKmh: number;
  rajadaKmh: number;
  ventoGraus: number;
  ventoDirecao: string;
  icone: Icone;
  descricao: string;
};

export type Dia = {
  data: string; // "2026-09-23"
  rotulo: string; // "Hoje", "Amanhã", "Sexta-feira"
  dataCurta: string; // "23 de setembro"
  max: number;
  min: number;
  chuvaMm: number;
  chanceChuva: number;
  icone: Icone;
  descricao: string;
  fonte: "simport" | "open-meteo";
  temHoras: boolean;
};

export type Agora = {
  temperatura: number;
  sensacao: number;
  umidade: number;
  chanceChuva: number;
  ventoKmh: number;
  rajadaKmh: number;
  ventoDirecao: string;
  ventoGraus: number;
  chuva24h: number | null;
  icone: Icone;
  descricao: string;
  hora: string; // "08:00"
  fonte: "estacao" | "composio" | "previsao";
};

export type Alerta = {
  nivel: "chuva" | "vento" | "tempo-bom" | "info";
  titulo: string;
  texto: string;
};

export type Boletim = { data: string; texto: string; tempoRuim: boolean };

export type Previsao = {
  cidade: string;
  uf: string;
  agora: Agora;
  alerta: Alerta;
  boletim: Boletim[];
  horas: Hora[];
  dias: Dia[];
  nascerSol: string | null;
  porSol: string | null;
  atualizadoEm: string;
  fontes: { simport: boolean; estacao: boolean; openMeteo: boolean; composio: boolean };
};

import { climaAgoraComposio, type ClimaComposio } from "@/lib/composio";

/** Código do OpenWeather (Composio) → ícone/descrição do CopaLinks. */
function doOpenWeather(c: number, diurno: boolean): { icone: Icone; descricao: string } {
  if (c >= 200 && c < 300) return { icone: "tempestade", descricao: "Trovoadas" };
  if (c >= 300 && c < 400) return { icone: "garoa", descricao: "Garoa" };
  if (c === 502 || c === 503 || c === 504 || c === 522) return { icone: "chuva-forte", descricao: "Chuva forte" };
  if (c >= 500 && c < 600) return { icone: "chuva", descricao: c === 500 ? "Chuva fraca" : "Chuva" };
  if (c >= 700 && c < 800) return { icone: "neblina", descricao: "Neblina" };
  if (c === 800) return diurno ? { icone: "sol", descricao: "Ensolarado" } : { icone: "lua", descricao: "Céu limpo" };
  if (c === 801 || c === 802) return { icone: diurno ? "sol-nuvem" : "lua-nuvem", descricao: "Parcialmente nublado" };
  return { icone: "nuvem", descricao: "Nublado" };
}

/* ------------------------------------------------------------ utilidades */
const DIRECOES = [
  "N", "NNE", "NE", "ENE", "L", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
];
export const direcao = (graus: number) =>
  DIRECOES[Math.round((((graus % 360) + 360) % 360) / 22.5) % 16];

const partes = (ts: number) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts * 1000));
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? "00";
  return { dia: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")), min: v("minute") };
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const SEMANA = [
  "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
  "Quinta-feira", "Sexta-feira", "Sábado",
];

function rotulosDia(data: string, hoje: string) {
  const [a, m, d] = data.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d, 12));
  const [ha, hm, hd] = hoje.split("-").map(Number);
  const dif = Math.round((base.getTime() - Date.UTC(ha, hm - 1, hd, 12)) / 86400000);
  return {
    rotulo: dif === 0 ? "Hoje" : dif === 1 ? "Amanhã" : SEMANA[base.getUTCDay()],
    dataCurta: `${d} de ${MESES[m - 1]}`,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/* ----------------------------------------------------- códigos de ícone */
// Simport usa os códigos da WeatherAPI (1000 = sol, 1063 = chuva fraca...).
function doSimport(codigo: number, diurno: boolean): { icone: Icone; descricao: string } {
  if (codigo === 1000) return diurno ? { icone: "sol", descricao: "Ensolarado" } : { icone: "lua", descricao: "Céu limpo" };
  if (codigo === 1003) return { icone: diurno ? "sol-nuvem" : "lua-nuvem", descricao: "Parcialmente nublado" };
  if (codigo === 1006) return { icone: "nuvem", descricao: "Nublado" };
  if (codigo === 1009) return { icone: "nuvem", descricao: "Encoberto" };
  if ([1030, 1135, 1147].includes(codigo)) return { icone: "neblina", descricao: "Neblina" };
  if ([1087, 1273, 1276, 1279, 1282].includes(codigo)) return { icone: "tempestade", descricao: "Trovoadas" };
  if ([1150, 1153, 1168, 1171, 1072].includes(codigo)) return { icone: "garoa", descricao: "Garoa" };
  if ([1063, 1180, 1183, 1240].includes(codigo)) return { icone: "chuva", descricao: "Chuva fraca" };
  if ([1186, 1189].includes(codigo)) return { icone: "chuva", descricao: "Chuva" };
  if ([1192, 1195, 1243, 1246].includes(codigo)) return { icone: "chuva-forte", descricao: "Chuva forte" };
  return { icone: "nuvem", descricao: "Nublado" };
}

// Open-Meteo usa os códigos WMO.
function doWmo(codigo: number): { icone: Icone; descricao: string } {
  if (codigo === 0) return { icone: "sol", descricao: "Ensolarado" };
  if (codigo <= 2) return { icone: "sol-nuvem", descricao: "Parcialmente nublado" };
  if (codigo === 3) return { icone: "nuvem", descricao: "Nublado" };
  if (codigo === 45 || codigo === 48) return { icone: "neblina", descricao: "Neblina" };
  if (codigo >= 51 && codigo <= 57) return { icone: "garoa", descricao: "Garoa" };
  if (codigo === 61 || codigo === 80) return { icone: "chuva", descricao: "Chuva fraca" };
  if (codigo === 63 || codigo === 81) return { icone: "chuva", descricao: "Pancadas de chuva" };
  if (codigo === 65 || codigo === 82) return { icone: "chuva-forte", descricao: "Chuva forte" };
  if (codigo >= 95) return { icone: "tempestade", descricao: "Trovoadas" };
  return { icone: "nuvem", descricao: "Nublado" };
}

/** Peso de cada condição (0 = céu limpo … 7 = temporal). Exportado para o radar da previsão. */
export const GRAVIDADE: Record<Icone, number> = {
  sol: 0, lua: 0, "sol-nuvem": 1, "lua-nuvem": 1, nuvem: 2, neblina: 3,
  garoa: 4, chuva: 5, "chuva-forte": 6, tempestade: 7,
};

/* ---------------------------------------------------------- consultas */
type Linha = { date: { sec: number } } & Record<string, number | { sec: number }>;

async function simport(consulta: Record<string, string | number>, extra = ""): Promise<Linha[]> {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(consulta).map(([k, v]) => [k, String(v)])),
  ).toString();
  const r = await fetch(`${SIMPORT_DADOS}?${q}${extra}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", "AUTH-TOKEN": SIMPORT_TOKEN },
  });
  if (!r.ok) throw new Error(`Simport ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

const num = (l: Linha, campo: string) => {
  const v = l[campo];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

async function lerBoletim(): Promise<Boletim[]> {
  const hoje = partes(Date.now() / 1000).dia;
  const q = new URLSearchParams({
    clientId: "appa",
    regionId: "57",
    statusId: "5",
    token: SIMPORT_TOKEN,
    startDate: `${hoje}T00:00:00.000Z`,
  });
  const r = await fetch(`${SIMPORT_BOLETIM}?${q}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const d = await r.json();
  const eventos: {
    startDate?: { date?: string };
    description?: { pt?: string };
    status?: { badWeather?: boolean };
  }[] = Array.isArray(d?.events) ? d.events : [];
  return eventos
    .map((e) => ({
      data: String(e.startDate?.date ?? "").slice(0, 10),
      texto: String(e.description?.pt ?? "").trim(),
      tempoRuim: Boolean(e.status?.badWeather),
    }))
    .filter((b) => b.texto && b.data >= hoje)
    .slice(0, 4);
}

type OpenMeteo = {
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
};

async function lerOpenMeteo(): Promise<OpenMeteo | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LOCAL.lat}&longitude=${LOCAL.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `precipitation_probability_max,sunrise,sunset&forecast_days=16&timezone=${encodeURIComponent(FUSO)}`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  return r.ok ? r.json() : null;
}

/* ---------------------------------------------------------- montagem */
async function montar(): Promise<Previsao> {
  const agoraTs = Math.floor(Date.now() / 1000);
  const hoje = partes(agoraTs).dia;

  const [prevTempo, prevVento, estTempo, estVento, boletim, om] = await Promise.all([
    simport({
      regionId: 57, stationId: 1, equipmentId: "F2", dataGroupId: "WRF5", interval: 291600,
      fields: "precipitation,temperature,relativeHumidity,thermalSensation,chanceOfRain,icon",
    }).catch(() => [] as Linha[]),
    simport({
      regionId: 57, stationId: 1, equipmentId: "F2", dataGroupId: "WRF1", interval: 291600,
      fields: "windSpeed,windGust,windDirection",
    }).catch(() => [] as Linha[]),
    simport({
      regionId: 57, stationId: 6, equipmentId: "F9", dataGroupId: "AP50", interval: 172800,
      fields: "temperatureAverage,thermalSensationAverage,humidityAverage,hourlyPrecipitation",
    }).catch(() => [] as Linha[]),
    simport({
      regionId: 57, stationId: 6, equipmentId: "F9", dataGroupId: "AP10", interval: 172800,
      fields: "windDirectionAverage,windSpeedAverage",
    }).catch(() => [] as Linha[]),
    lerBoletim().catch(() => [] as Boletim[]),
    lerOpenMeteo().catch(() => null),
  ]);

  const nascer = om?.daily?.sunrise?.[0]?.slice(11, 16) ?? null;
  const por = om?.daily?.sunset?.[0]?.slice(11, 16) ?? null;
  const minutos = (hhmm: string | null, padrao: number) =>
    hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : padrao;
  const nascerMin = minutos(nascer, 6 * 60);
  const porMin = minutos(por, 18 * 60);

  // ------------------------------------------- horas (previsão WRF)
  const ventoPor = new Map(prevVento.map((v) => [v.date.sec, v]));
  const todasHoras: Hora[] = prevTempo
    .map((t) => {
      const ts = t.date.sec;
      const p = partes(ts);
      const v = ventoPor.get(ts);
      const minDoDia = p.hora * 60 + 30;
      const cond = doSimport(num(t, "icon") ?? 1006, minDoDia >= nascerMin && minDoDia < porMin);
      const graus = (v && num(v, "windDirection")) ?? 0;
      return {
        ts,
        hora: `${String(p.hora).padStart(2, "0")}h`,
        dia: p.dia,
        temperatura: Math.round(num(t, "temperature") ?? 0),
        sensacao: Math.round(num(t, "thermalSensation") ?? num(t, "temperature") ?? 0),
        umidade: Math.round(num(t, "relativeHumidity") ?? 0),
        chanceChuva: Math.round(num(t, "chanceOfRain") ?? 0),
        chuvaMm: r1(num(t, "precipitation") ?? 0),
        ventoKmh: Math.round(((v && num(v, "windSpeed")) ?? 0) * NOS_PARA_KMH),
        rajadaKmh: Math.round(((v && num(v, "windGust")) ?? 0) * NOS_PARA_KMH),
        ventoGraus: graus,
        ventoDirecao: direcao(graus),
        ...cond,
      };
    })
    .sort((a, b) => a.ts - b.ts);

  const horaAtual = todasHoras.filter((h) => h.ts <= agoraTs).pop() ?? todasHoras[0];
  const futuras = todasHoras.filter((h) => h.ts > agoraTs - 3600);

  // --------------------------------------- agora (estação do porto)
  const ultEst = estTempo.at(-1);
  const ultVento = estVento.at(-1);
  const estRecente = ultEst && agoraTs - ultEst.date.sec < 90 * 60;
  const ventoRecente = ultVento && agoraTs - ultVento.date.sec < 90 * 60;

  // A estação acumula a chuva dentro de cada hora cheia e zera na virada:
  // o total de 24h é a soma do maior valor de cada hora.
  let chuva24h: number | null = null;
  if (estTempo.length) {
    const porHora = new Map<string, number>();
    for (const l of estTempo) {
      if (agoraTs - l.date.sec > 24 * 3600) continue;
      const p = partes(l.date.sec);
      const k = `${p.dia}-${p.hora}`;
      porHora.set(k, Math.max(porHora.get(k) ?? 0, num(l, "hourlyPrecipitation") ?? 0));
    }
    chuva24h = r1([...porHora.values()].reduce((s, v) => s + v, 0));
  }

  // Estação do porto fora do ar: o "agora" vem do Composio (OpenWeather),
  // que é medição real — melhor que usar só a previsão da hora.
  let cc: ClimaComposio | null = null;
  if (!estRecente) cc = await climaAgoraComposio().catch(() => null);

  const pAgora = partes(agoraTs);
  // Medição da estação (se recente); senão, a previsão da hora atual.
  const medido = (campo: string, previsto: number | undefined) =>
    Math.round((estRecente && ultEst ? num(ultEst, campo) : null) ?? previsto ?? 0);
  const grausAgora =
    ventoRecente && ultVento
      ? num(ultVento, "windDirectionAverage") ?? 0
      : horaAtual?.ventoGraus ?? 0;
  const agora: Agora = {
    temperatura: medido("temperatureAverage", horaAtual?.temperatura),
    sensacao: medido("thermalSensationAverage", horaAtual?.sensacao),
    umidade: medido("humidityAverage", horaAtual?.umidade),
    chanceChuva: horaAtual?.chanceChuva ?? 0,
    ventoKmh: Math.round(
      ventoRecente && ultVento
        ? (num(ultVento, "windSpeedAverage") ?? 0) * NOS_PARA_KMH
        : horaAtual?.ventoKmh ?? 0,
    ),
    rajadaKmh: horaAtual?.rajadaKmh ?? 0,
    ventoGraus: grausAgora,
    ventoDirecao: direcao(grausAgora),
    chuva24h,
    icone: horaAtual?.icone ?? "nuvem",
    descricao: horaAtual?.descricao ?? "Nublado",
    hora: `${String(pAgora.hora).padStart(2, "0")}:${pAgora.min}`,
    fonte: estRecente ? "estacao" : cc ? "composio" : "previsao",
  };
  if (cc) {
    const minAgora = pAgora.hora * 60 + Number(pAgora.min);
    agora.temperatura = Math.round(cc.temperatura);
    agora.sensacao = Math.round(cc.sensacao);
    agora.umidade = cc.umidade;
    agora.ventoKmh = cc.ventoKmh;
    agora.rajadaKmh = Math.max(agora.rajadaKmh, cc.rajadaKmh);
    agora.ventoGraus = cc.ventoGraus;
    agora.ventoDirecao = direcao(cc.ventoGraus);
    // Sem previsão da hora, o ícone também vem da medição do Composio.
    if (!horaAtual) Object.assign(agora, doOpenWeather(cc.codigo, minAgora >= nascerMin && minAgora < porMin));
  }
  // Está chovendo agora na estação? Isso manda no ícone e no texto.
  const chuvaAgora = estRecente && ultEst ? num(ultEst, "hourlyPrecipitation") ?? 0 : 0;
  if (chuvaAgora >= 0.2 && GRAVIDADE[agora.icone] < GRAVIDADE.chuva) {
    agora.icone = chuvaAgora >= 4 ? "chuva-forte" : "chuva";
    agora.descricao = chuvaAgora >= 4 ? "Chuva forte" : "Chuva";
  }

  // ---------------------------------------------------------- dias
  const diasSimport = new Map<string, Hora[]>();
  for (const h of todasHoras) diasSimport.set(h.dia, [...(diasSimport.get(h.dia) ?? []), h]);

  const dias: Dia[] = [];
  const datas = om?.daily?.time ?? [...diasSimport.keys()];
  datas.forEach((data, i) => {
    if (data < hoje) return;
    const hs = diasSimport.get(data) ?? [];
    const { rotulo, dataCurta } = rotulosDia(data, hoje);
    if (hs.length >= 20) {
      // Dia coberto pelo WRF da APPA: resumo pelas horas da Simport.
      const pior = hs
        .filter((h) => {
          const hr = Number(h.hora.slice(0, 2));
          return hr >= 6 && hr <= 20;
        })
        .reduce((a, h) => (GRAVIDADE[h.icone] > GRAVIDADE[a.icone] ? h : a), hs[12] ?? hs[0]);
      const chuva = r1(hs.reduce((s, h) => s + h.chuvaMm, 0));
      const cond = { icone: pior.icone, descricao: pior.descricao };
      if (cond.icone === "lua" || cond.icone === "lua-nuvem") cond.icone = cond.icone === "lua" ? "sol" : "sol-nuvem";
      if (chuva >= 5 && GRAVIDADE[cond.icone] <= GRAVIDADE.chuva) {
        cond.icone = "chuva";
        cond.descricao = "Pancadas de chuva";
      }
      dias.push({
        data, rotulo, dataCurta,
        max: Math.max(...hs.map((h) => h.temperatura)),
        min: Math.min(...hs.map((h) => h.temperatura)),
        chuvaMm: chuva,
        chanceChuva: Math.max(...hs.map((h) => h.chanceChuva)),
        ...cond,
        fonte: "simport",
        temHoras: true,
      });
    } else if (om?.daily) {
      const d = om.daily;
      dias.push({
        data, rotulo, dataCurta,
        max: Math.round(d.temperature_2m_max[i]),
        min: Math.round(d.temperature_2m_min[i]),
        chuvaMm: r1(d.precipitation_sum[i] ?? 0),
        chanceChuva: Math.round(d.precipitation_probability_max[i] ?? 0),
        ...doWmo(d.weather_code[i]),
        fonte: "open-meteo",
        temHoras: hs.length > 0,
      });
    }
  });

  // -------------------------------------------------------- alerta
  const prox6 = futuras.slice(0, 6);
  const maxChance = Math.max(0, ...prox6.map((h) => h.chanceChuva));
  const mmProx = r1(prox6.reduce((s, h) => s + h.chuvaMm, 0));
  const maxRajada = Math.max(0, ...prox6.map((h) => h.rajadaKmh));
  let alerta: Alerta;
  if (chuvaAgora >= 0.2) {
    alerta = {
      nivel: "chuva",
      titulo: "Chovendo no porto",
      texto: `A estação da APPA registra chuva agora (${r1(chuvaAgora)} mm nesta hora).`,
    };
  } else if (maxChance >= 60 && mmProx >= 0.3) {
    alerta = {
      nivel: "chuva",
      titulo: "Chuva se aproximando",
      texto: `Chuva provável nas próximas horas (${maxChance}% de chance).`,
    };
  } else if (maxRajada >= 40) {
    alerta = {
      nivel: "vento",
      titulo: "Ventos fortes",
      texto: `Rajadas de até ${maxRajada} km/h nas próximas horas.`,
    };
  } else if (maxChance < 30) {
    alerta = {
      nivel: "tempo-bom",
      titulo: "Sem chuva prevista",
      texto: "Tempo firme nas próximas 6 horas.",
    };
  } else {
    alerta = {
      nivel: "info",
      titulo: "Possibilidade de chuva",
      texto: `Chance de chuva de até ${maxChance}% nas próximas horas.`,
    };
  }

  return {
    cidade: LOCAL.cidade,
    uf: LOCAL.uf,
    agora,
    alerta,
    boletim,
    horas: futuras,
    dias: dias.slice(0, 15),
    nascerSol: nascer,
    porSol: por,
    atualizadoEm: new Date().toISOString(),
    fontes: {
      simport: todasHoras.length > 0,
      estacao: Boolean(estRecente),
      openMeteo: Boolean(om?.daily),
      composio: Boolean(cc),
    },
  };
}

/* ------------------------------------------------------------- cache */
let cache: { em: number; dados: Previsao } | null = null;
let emAndamento: Promise<Previsao> | null = null;

export async function obterPrevisao(forcar = false): Promise<Previsao> {
  if (!forcar && cache && Date.now() - cache.em < VIDA_CACHE) return cache.dados;
  if (!emAndamento) {
    emAndamento = montar()
      .then((dados) => {
        if (dados.fontes.simport || dados.fontes.openMeteo || dados.fontes.composio) cache = { em: Date.now(), dados };
        return dados;
      })
      .finally(() => {
        emAndamento = null;
      });
  }
  try {
    return await emAndamento;
  } catch (e) {
    if (cache) return cache.dados;
    throw e;
  }
}

/** Resumo do tempo em uma frase. */
export function resumoEmTexto(p: Previsao) {
  const a = p.agora;
  const hoje = p.dias[0];
  const partesTexto = [
    `Agora em ${p.cidade}: ${a.temperatura}°C, ${a.descricao.toLowerCase()}, umidade ${a.umidade}%, vento ${a.ventoKmh} km/h ${a.ventoDirecao}.`,
    `${p.alerta.titulo}: ${p.alerta.texto}`,
  ];
  if (hoje) partesTexto.push(`Hoje: máxima ${hoje.max}°, mínima ${hoje.min}°, ${hoje.chanceChuva}% de chance de chuva.`);
  if (p.boletim[0]) partesTexto.push(`Boletim APPA: ${p.boletim[0].texto}`);
  return partesTexto.join(" ");
}
