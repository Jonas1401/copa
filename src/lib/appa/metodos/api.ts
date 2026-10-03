import {
  SIMPORT_BOLETIM,
  SIMPORT_COD_CHUVA_FORTE,
  SIMPORT_COD_TEMPESTADE,
  SIMPORT_DADOS,
  SIMPORT_TOKEN,
} from "@/lib/tempo";
import { resumirPainel } from "../analise";
import { leituraUtil, sanearPainel } from "../painel";
import { semHtml } from "../texto";
import { ErroMetodo, type PainelSimport, type SaidaMetodo, type Sinais } from "../tipos";

/**
 * MÉTODO 1 — API / endpoints de dados.
 *
 * O painel da APPA é uma página que se monta no navegador, e o que ela mostra
 * vem de endpoints JSON do SIMPORT® (os mesmos que a tela Tempo já usa). Ler
 * direto essa fonte é o caminho mais confiável: não depende de renderizar
 * página nem de OCR. Aqui as respostas viram o MESMO `PainelSimport` que os
 * métodos de texto produzem, com a mesma amostragem do painel (de 2 em 2 horas,
 * 24 h à frente), para os números serem comparáveis entre métodos.
 */

type Linha = { date: { sec: number } } & Record<string, unknown>;
type Evento = {
  startDate?: { date?: string };
  description?: { pt?: string };
  status?: { badWeather?: boolean };
};

export type DadosSimport = {
  /** Previsão WRF: chuva, temperatura, umidade, chance de chuva e ícone. */
  wrf5: Linha[];
  /** Previsão WRF: vento (nós). */
  wrf1: Linha[];
  /** Estação do porto: temperatura, umidade e chuva da hora. */
  ap50: Linha[];
  /** Estação do porto: vento (nós). */
  ap10: Linha[];
  /** Pressão (hPa), quando a estação informa. */
  pressao: Linha[];
  boletim: Evento[];
};

const REGIAO = { regionId: 57 };
const CONSULTAS = {
  wrf5: {
    ...REGIAO, stationId: 1, equipmentId: "F2", dataGroupId: "WRF5", interval: 291600,
    fields: "precipitation,temperature,relativeHumidity,thermalSensation,chanceOfRain,icon",
  },
  wrf1: {
    ...REGIAO, stationId: 1, equipmentId: "F2", dataGroupId: "WRF1", interval: 291600,
    fields: "windSpeed,windGust,windDirection",
  },
  ap50: {
    ...REGIAO, stationId: 6, equipmentId: "F9", dataGroupId: "AP50", interval: 172800,
    fields: "temperatureAverage,thermalSensationAverage,humidityAverage,hourlyPrecipitation",
  },
  ap10: {
    ...REGIAO, stationId: 6, equipmentId: "F9", dataGroupId: "AP10", interval: 172800,
    fields: "windDirectionAverage,windSpeedAverage",
  },
} as const;

/**
 * A pressão não é um dos campos que a tela Tempo usa, então o nome do campo é
 * sondado em separado (uma falha aqui NUNCA derruba a leitura) e a resposta é
 * lembrada por algumas horas para não insistir à toa.
 */
const CAMPOS_PRESSAO = ["pressureAverage", "atmosphericPressureAverage", "barometricPressureAverage", "pressure"];
const ESPERA_SONDA_PRESSAO_MS = 6 * 3_600_000;
let sondaPressaoLivreEm = 0;

/** Zera a memória da sonda de pressão (usado nos testes). */
export function resetarSondaPressao() {
  sondaPressaoLivreEm = 0;
}

/**
 * Token que o próprio site da APPA entrega ao navegador, quando o do ambiente
 * deixa de valer (a Simport pode trocá-lo). Fica só na memória do processo.
 */
let tokenDescoberto: string | null = null;
export const definirTokenDescoberto = (t: string | null) => {
  tokenDescoberto = t;
};
export const tokenEmUso = () => tokenDescoberto ?? SIMPORT_TOKEN;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Resposta = { ok: true; dados: unknown } | { ok: false; erro: string; status?: number };

/** GET que devolve JSON. Repete uma vez erro de rede/5xx; nunca joga exceção. */
async function pedirJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Resposta> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) {
        const texto = await r.text();
        try {
          return { ok: true, dados: JSON.parse(texto) };
        } catch {
          return { ok: false, erro: "a resposta não é JSON" };
        }
      }
      if ((r.status >= 500 || r.status === 429) && tentativa === 0) {
        await pausa(400);
        continue;
      }
      return { ok: false, erro: `HTTP ${r.status}`, status: r.status };
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        return { ok: false, erro: `sem resposta em ${Math.round(timeoutMs / 1000)} s` };
      }
      if (tentativa === 0) {
        await pausa(400);
        continue;
      }
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: false, erro: "sem resposta" };
}

const linhas = (r: Resposta): Linha[] =>
  r.ok && Array.isArray(r.dados)
    ? (r.dados as Linha[]).filter((l) => typeof l?.date?.sec === "number")
    : [];

/* ------------------------------------------------------------ montagem */
const num = (l: Linha | undefined, campo: string): number | null => {
  const v = l?.[campo];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const FUSO = "America/Sao_Paulo";
const hhmm = (sec: number) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(sec * 1000),
  );
const diaLocal = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );

/** Direção em graus → rosa dos ventos com a mesma grafia do painel (W, SE, NNE…). */
const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const cardinal = (graus: number | null) =>
  graus == null ? "" : ROSA[Math.round((((graus % 360) + 360) % 360) / 22.5) % 16];

/** O painel mostra "< 0.1 mm" para chuva ínfima: o mesmo valor que o parser lê. */
const mmPainel = (v: number | null) => (v == null || v <= 0 ? 0 : v < 0.1 ? 0.1 : Math.round(v * 10) / 10);

/** Linha mais próxima de um instante (dentro da tolerância); as séries são horárias. */
function maisPerto(serie: Linha[], sec: number, toleranciaSec = 2100): Linha | undefined {
  let melhor: Linha | undefined;
  let dist = Number.POSITIVE_INFINITY;
  for (const l of serie) {
    const d = Math.abs(l.date.sec - sec);
    if (d < dist) {
      dist = d;
      melhor = l;
    }
  }
  return melhor && dist <= toleranciaSec ? melhor : undefined;
}

/** Última medição da estação, se for recente. */
function ultimaMedicao(serie: Linha[], agoraSec: number, maxIdadeSec = 90 * 60): Linha | undefined {
  const l = serie.filter((x) => x.date.sec <= agoraSec + 300).sort((a, b) => b.date.sec - a.date.sec)[0];
  return l && agoraSec - l.date.sec <= maxIdadeSec ? l : undefined;
}

/**
 * Respostas do SIMPORT → painel interpretado. Puro (sem rede): também é usado
 * pelo navegador automático, que intercepta essas mesmas respostas (XHR) da
 * página renderizada.
 */
export function painelDeDadosSimport(
  d: DadosSimport,
  agoraMs: number,
): { painel: PainelSimport; sinais: Sinais; atualizadoEm: string | null } {
  const agoraSec = Math.floor(agoraMs / 1000);
  const horaCheia = Math.floor(agoraSec / 3600) * 3600;
  const sinais: Sinais = { chuvaForteHoras: [], tempestadeHoras: [], alertas: [] };

  const chuva: PainelSimport["chuva"] = [];
  const vento: PainelSimport["vento"] = [];
  // Mesmas linhas do painel: da hora atual, de 2 em 2 horas, por 24 h.
  const wrfAtual = d.wrf5.some((l) => l.date.sec >= horaCheia - 3600);
  for (let k = 0; k < 12 && wrfAtual; k++) {
    const sec = horaCheia + k * 7200;
    const t = maisPerto(d.wrf5, sec);
    if (t) {
      chuva.push({
        hora: hhmm(sec),
        mm: mmPainel(num(t, "precipitation")),
        prob: Math.round(num(t, "chanceOfRain") ?? 0),
      });
      const icone = num(t, "icon");
      if (icone != null && SIMPORT_COD_TEMPESTADE.includes(icone)) sinais.tempestadeHoras!.push(hhmm(sec));
      if (icone != null && SIMPORT_COD_CHUVA_FORTE.includes(icone)) sinais.chuvaForteHoras!.push(hhmm(sec));
    }
    const v = maisPerto(d.wrf1, sec);
    const nos = num(v, "windSpeed");
    if (v && nos != null) {
      vento.push({ hora: hhmm(sec), nos: Math.round(nos), direcao: cardinal(num(v, "windDirection")) });
    }
  }

  // Agora: a estação do porto (se recente); senão, a hora atual do modelo.
  const estT = ultimaMedicao(d.ap50, agoraSec);
  const estV = ultimaMedicao(d.ap10, agoraSec);
  const wrfT = wrfAtual ? maisPerto(d.wrf5, horaCheia) : undefined;
  const wrfV = wrfAtual ? maisPerto(d.wrf1, horaCheia) : undefined;
  const pressaoLinha = [...d.pressao].sort((a, b) => b.date.sec - a.date.sec)[0];
  let pressao: number | null = null;
  for (const campo of CAMPOS_PRESSAO) {
    const v = num(pressaoLinha, campo);
    if (v == null) continue;
    // hPa (1013) · kPa (101,3) · Pa (101300)
    pressao = v > 50_000 ? v / 100 : v < 200 ? v * 10 : v;
    break;
  }
  const graus = num(estV, "windDirectionAverage") ?? num(wrfV, "windDirection");
  const painelAgora: PainelSimport["agora"] = {
    temperatura: num(estT, "temperatureAverage") ?? num(wrfT, "temperature"),
    sensacao: num(estT, "thermalSensationAverage") ?? num(wrfT, "thermalSensation"),
    umidade: num(estT, "humidityAverage") ?? num(wrfT, "relativeHumidity"),
    ventoNos: num(estV, "windSpeedAverage") ?? num(wrfV, "windSpeed"),
    direcao: cardinal(graus) || null,
    pressao,
  };
  sinais.chuvaAgoraMm = estT ? num(estT, "hourlyPrecipitation") : null;

  // Boletim da APPA por dia (o painel mostra "Sáb (03/10): …").
  const hoje = diaLocal(agoraMs);
  const boletim: PainelSimport["boletim"] = [];
  for (const e of d.boletim) {
    const data = String(e.startDate?.date ?? "").slice(0, 10);
    const texto = semHtml(String(e.description?.pt ?? ""));
    if (!texto || data < hoje || !/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    const dia = `${data.slice(8, 10)}/${data.slice(5, 7)}`;
    boletim.push({ dia, texto });
    if (e.status?.badWeather) sinais.alertas!.push(`${dia}: a APPA marcou tempo ruim no boletim do porto`);
  }

  const medidas = [estT, estV].filter(Boolean) as Linha[];
  const maisRecente = medidas.length ? Math.max(...medidas.map((l) => l.date.sec)) : null;
  return {
    painel: sanearPainel({
      boletim: boletim.slice(0, 4),
      chuva,
      vento,
      mares: [], // a tábua de marés não vem destes endpoints (só do painel renderizado)
      nascerSol: null,
      porSol: null,
      agora: painelAgora,
    }),
    sinais,
    atualizadoEm: maisRecente ? new Date(maisRecente * 1000).toISOString() : null,
  };
}

/* -------------------------------------------------------------- método */
export type OpcoesApi = {
  timeoutMs?: number;
  /** Token da Simport (por padrão o de `SIMPORT_AUTH_TOKEN`). O HTML pode descobrir outro no site. */
  token?: string;
  /** Relógio de teste. */
  agoraMs?: number;
};

const consulta = (c: Record<string, string | number>) =>
  new URLSearchParams(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)]))).toString();

export async function lerViaApi(opcoes: OpcoesApi = {}): Promise<SaidaMetodo> {
  const timeoutMs = Math.max(2000, Math.min(opcoes.timeoutMs ?? 9000, 20_000));
  const token = opcoes.token ?? tokenEmUso();
  const agoraMs = opcoes.agoraMs ?? Date.now();
  const headers = { "Content-Type": "application/json", "AUTH-TOKEN": token };
  const dados = (c: Record<string, string | number>, extra = "") =>
    pedirJson(`${SIMPORT_DADOS}?${consulta(c)}${extra}`, headers, timeoutMs);

  const sondar = agoraMs >= sondaPressaoLivreEm;
  const [wrf5, wrf1, ap50, ap10, cal, pr] = await Promise.all([
    dados(CONSULTAS.wrf5),
    dados(CONSULTAS.wrf1),
    dados(CONSULTAS.ap50),
    dados(CONSULTAS.ap10),
    pedirJson(
      `${SIMPORT_BOLETIM}?${new URLSearchParams({
        clientId: "appa",
        regionId: "57",
        statusId: "5",
        token,
        startDate: `${diaLocal(agoraMs)}T00:00:00.000Z`,
      })}`,
      {},
      timeoutMs,
    ),
    sondar
      ? dados({ ...CONSULTAS.ap50, interval: 7200, fields: CAMPOS_PRESSAO.join(",") })
      : Promise.resolve<Resposta>({ ok: false, erro: "sonda de pressão em espera" }),
  ]);

  const eventos = cal.ok && Array.isArray((cal.dados as { events?: unknown })?.events)
    ? ((cal.dados as { events: Evento[] }).events)
    : [];
  const montado = painelDeDadosSimport(
    { wrf5: linhas(wrf5), wrf1: linhas(wrf1), ap50: linhas(ap50), ap10: linhas(ap10), pressao: linhas(pr), boletim: eventos },
    agoraMs,
  );
  if (sondar) {
    const achou = montado.painel.agora.pressao != null;
    sondaPressaoLivreEm = achou ? 0 : agoraMs + ESPERA_SONDA_PRESSAO_MS;
  }

  const consultas: [string, Resposta][] = [
    ["previsão WRF (chuva)", wrf5],
    ["previsão WRF (vento)", wrf1],
    ["estação (tempo)", ap50],
    ["estação (vento)", ap10],
    ["boletim", cal],
  ];
  const falhas = consultas.filter(([, r]) => !r.ok) as [string, Extract<Resposta, { ok: false }>][];

  if (!leituraUtil(montado.painel)) {
    const recusado = falhas.length > 0 && falhas.every(([, r]) => r.status === 401 || r.status === 403);
    // O token descoberto no site deixou de valer: volta para o do ambiente no próximo ciclo.
    if (recusado && opcoes.token == null) tokenDescoberto = null;
    const detalhe = falhas.length
      ? falhas.map(([nome, r]) => `${nome}: ${r.erro}`).join(" · ")
      : "as respostas vieram vazias ou desatualizadas";
    throw new ErroMetodo(
      recusado ? `a Simport recusou o token (${detalhe}); confira SIMPORT_AUTH_TOKEN` : detalhe,
      falhas.length ? "falhou" : "vazio",
    );
  }
  return {
    ...montado,
    resumo: `${resumirPainel(montado.painel)}${falhas.length ? ` (falhou: ${falhas.map(([n]) => n).join(", ")})` : ""}`,
  };
}
