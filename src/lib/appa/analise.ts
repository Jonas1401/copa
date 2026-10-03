import { fmtNum } from "./texto";
import type {
  AnaliseChuva,
  AnaliseVento,
  DetalhesLeitura,
  EventoTexto,
  LeituraAppa,
  MetodoLeitura,
  PainelSimport,
  Sinais,
} from "./tipos";

/**
 * Do painel para a leitura NORMALIZADA: classifica chuva (fraca, moderada,
 * forte), vento, tempestade e alertas, e escreve os campos em português que o
 * restante do aplicativo consome (`LeituraAppa`). Puro: sem rede nem banco.
 */

/* Limiares (mm por hora, na linha da tabela de chuva da APPA). */
export const CHUVA_FRACA_MM = 0.2;
export const CHUVA_MODERADA_MM = 1;
/** Mesmo limite que a estação do porto usa em `tempo.ts` para "chuva forte". */
export const CHUVA_FORTE_MM = 4;
/** Escala Beaufort 6 ("vento forte"): 22 nós ≈ 41 km/h. */
export const VENTO_FORTE_NOS = 22;
export const NOS_PARA_KMH = 1.852;

export const NOME_NIVEL_CHUVA = ["sem chuva", "chuva fraca", "chuva moderada", "chuva forte"] as const;

export const nivelChuva = (mm: number) =>
  mm >= CHUVA_FORTE_MM ? 3 : mm >= CHUVA_MODERADA_MM ? 2 : mm >= CHUVA_FRACA_MM ? 1 : 0;

const mmTxt = (mm: number) => `${fmtNum(mm)} mm`;

/* ---------------------------------------------------------------- chuva */
export function analisarChuva(p: PainelSimport, sinais: Sinais = {}): AnaliseChuva {
  const linhas = p.chuva;
  const niveis = linhas.map((c) => nivelChuva(c.mm));
  const iconeForte = (sinais.chuvaForteHoras ?? []).length > 0 || (sinais.tempestadeHoras ?? []).length > 0;
  const nivelMax = Math.max(0, ...niveis, iconeForte ? 3 : 0);
  const medido = sinais.chuvaAgoraMm ?? null;
  const nivelAgora = medido != null ? nivelChuva(medido) : linhas[0] ? niveis[0] : 0;

  const mmMax = Math.max(0, ...linhas.map((c) => c.mm));
  const probMax = Math.max(0, ...linhas.map((c) => c.prob));
  const pico = mmMax > 0 ? linhas.find((c) => c.mm === mmMax) : linhas.find((c) => c.prob === probMax && probMax > 0);
  return {
    nivelAgora,
    nivelMax,
    mmMax,
    probMax,
    horaInicio: linhas.find((c) => nivelChuva(c.mm) >= 1)?.hora ?? null,
    horaForte: linhas.find((c) => nivelChuva(c.mm) >= 3)?.hora ?? sinais.chuvaForteHoras?.[0] ?? null,
    horaPico: pico?.hora ?? null,
    chovendoAgora: nivelAgora >= 1,
  };
}

/* ---------------------------------------------------------------- vento */
export function analisarVento(p: PainelSimport): AnaliseVento {
  const nosAgora = p.agora.ventoNos ?? p.vento[0]?.nos ?? null;
  let pico: PainelSimport["vento"][number] | null = null;
  for (const v of p.vento) if (!pico || v.nos > pico.nos) pico = v;
  const nosMax = pico?.nos ?? 0;
  const ref = Math.max(nosMax, nosAgora ?? 0);
  return {
    nosAgora,
    nosMax,
    horaMax: pico?.hora ?? null,
    direcaoMax: pico?.direcao || null,
    classe: ref < 1 ? "calmo" : ref < 7 ? "fraco" : ref < VENTO_FORTE_NOS ? "moderado" : "forte",
  };
}

/* --------------------------------------------------------------- textos */
const RE_TEMPESTADE =
  /\b(tempestades?|trovoadas?|temporais?|raios?|rel[âa]mpagos?|descargas?\s+el[ée]tricas?|atividades?\s+el[ée]tricas?|granizo|tornados?|ciclones?)\b/i;
const RE_CHUVA_FORTE =
  /\b(chuvas?\s+(?:muito\s+|bastante\s+)?(?:fortes?|intensas?|volumosas?|torrenciais)|pancadas?\s+(?:de\s+chuva\s+)?(?:muito\s+)?(?:fortes?|intensas?)|temporais?)\b/i;
const RE_VENTO_FORTE = /\b(ventos?\s+(?:muito\s+)?fortes?|rajadas?(?:\s+de\s+vento)?|ventania|vendaval)\b/i;
const RE_ALERTA = /\b(aten[çc][ãa]o|alerta|aviso)\s*:/i;
// Sem \b: ele não enxerga letras acentuadas ("há", "não") como parte da palavra.
const RE_NEGACAO =
  /(?<![\p{L}])(sem|n[ãa]o\s+(?:h[áa]|deve|s[ãa]o|ocorrer[ãa]o|se\s+prev[êe])|nenhum[a]?|descartad[oa]s?|improv[áa]vel)(?![\p{L}])/iu;
const RE_PERIODO = /(?<![\p{L}])(madrugada|manh[ãa]|tarde|noite|dia\s+todo)(?![\p{L}])/giu;

const frases = (texto: string) => texto.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean);

/** A palavra aparece afirmando o fenômeno ("há possibilidade de tempestades") e não negando ("sem previsão de chuva forte")? */
function achaAfirmado(frase: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of frase.matchAll(g)) {
    const antes = frase.slice(Math.max(0, (m.index ?? 0) - 48), m.index ?? 0);
    if (!RE_NEGACAO.test(antes)) return true;
  }
  return false;
}

function periodoDe(frase: string): string | null {
  const achados = [...new Set([...frase.matchAll(RE_PERIODO)].map((m) => m[1].toLowerCase()))];
  return achados.length ? achados.join(" e ") : null;
}

const cortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function analisarTextos(
  p: PainelSimport,
  sinais: Sinais = {},
): { tempestade: EventoTexto; chuvaForte: EventoTexto; alertas: string[] } {
  let tempestade: EventoTexto = { prevista: false, trecho: null, horario: null };
  let chuvaForte: EventoTexto = { prevista: false, trecho: null, horario: null };
  const alertas: string[] = [];

  for (const b of p.boletim) {
    const marcado = RE_ALERTA.test(b.texto);
    let grave = false;
    for (const f of frases(b.texto)) {
      const periodo = periodoDe(f);
      const quando = [b.dia, periodo].filter(Boolean).join(", ");
      if (achaAfirmado(f, RE_TEMPESTADE)) {
        grave = true;
        if (!tempestade.prevista) tempestade = { prevista: true, trecho: cortar(f, 180), horario: quando };
      }
      if (achaAfirmado(f, RE_CHUVA_FORTE)) {
        grave = true;
        if (!chuvaForte.prevista) chuvaForte = { prevista: true, trecho: cortar(f, 180), horario: quando };
      }
      if (achaAfirmado(f, RE_VENTO_FORTE)) grave = true;
    }
    if (marcado || grave) alertas.push(`${b.dia}: ${cortar(b.texto, 220)}`);
  }

  // Ícones do modelo da APPA (API): tempestade/chuva forte por horário.
  const tHora = sinais.tempestadeHoras?.[0];
  if (tHora && !tempestade.prevista) {
    tempestade = { prevista: true, trecho: "o modelo da APPA prevê trovoadas", horario: tHora };
    alertas.push(`Modelo da APPA prevê trovoadas às ${tHora}`);
  }
  const fHora = sinais.chuvaForteHoras?.[0];
  if (fHora && !chuvaForte.prevista) {
    chuvaForte = { prevista: true, trecho: "o modelo da APPA prevê chuva forte", horario: fHora };
  }

  for (const a of sinais.alertas ?? []) if (a && !alertas.includes(a)) alertas.push(a);
  return { tempestade, chuvaForte, alertas: [...new Set(alertas)].slice(0, 6) };
}

/* ---------------------------------------------------------- normalização */
const inteiro = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n));

function textoChuva(c: AnaliseChuva, tem: boolean): string | null {
  if (!tem) return null;
  if (c.chovendoAgora) return `${NOME_NIVEL_CHUVA[Math.max(1, c.nivelAgora)]} agora`;
  if (c.horaInicio) {
    const pico = c.horaPico ? `, pico de ${mmTxt(c.mmMax)} às ${c.horaPico}` : "";
    return `${NOME_NIVEL_CHUVA[Math.max(1, c.nivelMax)]} prevista a partir das ${c.horaInicio} (${c.probMax}% de chance${pico})`;
  }
  return c.probMax > 0
    ? `sem chuva significativa nas próximas 24 h (chance máxima de ${c.probMax}%)`
    : "sem chuva prevista nas próximas 24 h";
}

/** Chuva forte: vale a tabela (mm) e, na falta dela, o boletim ou o ícone do modelo. */
function textoChuvaForte(e: EventoTexto, c: AnaliseChuva, temDados: boolean): string | null {
  if (c.nivelMax >= 3 && c.mmMax >= CHUVA_FORTE_MM) {
    const hora = c.horaForte ?? c.horaPico;
    return `sim · ${mmTxt(c.mmMax)}${hora ? ` às ${hora}` : ""}`;
  }
  if (e.prevista) return `sim · ${[e.horario, e.trecho].filter(Boolean).join(" · ")}`;
  return temDados ? "não" : null;
}

function textoTempestade(e: EventoTexto, temDados: boolean): string | null {
  if (e.prevista) return `sim · ${[e.horario, e.trecho].filter(Boolean).join(" · ")}`;
  return temDados ? "não" : null;
}

/** Monta a leitura normalizada a partir do painel interpretado por qualquer método. */
export function normalizarLeitura(entrada: {
  painel: PainelSimport;
  metodo: MetodoLeitura;
  em?: Date;
  atualizadoEm?: string | null;
  sinais?: Sinais;
}): LeituraAppa {
  const { painel, metodo } = entrada;
  const sinais = entrada.sinais ?? {};
  const chuva = analisarChuva(painel, sinais);
  const vento = analisarVento(painel);
  const { tempestade, chuvaForte, alertas } = analisarTextos(painel, sinais);

  const temChuva = painel.chuva.length > 0 || sinais.chuvaAgoraMm != null;
  const temTextos = painel.boletim.length > 0;

  // Chuva forte: a tabela (mm) ou o boletim/modelo. Tempestade: boletim/modelo (a tabela não diz).
  const chuvaForteEvento: EventoTexto =
    chuvaForte.prevista || chuva.nivelMax < 3
      ? chuvaForte
      : { prevista: true, trecho: null, horario: chuva.horaForte ?? chuva.horaPico };

  const nos = vento.nosAgora;
  const ventoPartes: string[] = [];
  if (nos != null) {
    ventoPartes.push(
      `${fmtNum(nos)} nós${painel.agora.direcao ? ` ${painel.agora.direcao}` : ""} (${Math.round(nos * NOS_PARA_KMH)} km/h)`,
    );
  }
  if (painel.vento.length) {
    ventoPartes.push(
      `${nos != null ? "" : "previsto: "}máx. ${fmtNum(vento.nosMax)} nós${vento.horaMax ? ` às ${vento.horaMax}` : ""}`.trim(),
    );
  }

  const temAgora = painel.agora.temperatura != null || painel.agora.ventoNos != null || painel.agora.umidade != null;
  return {
    fonte: "APPA",
    timestamp_leitura: (entrada.em ?? new Date()).toISOString(),
    atualizado_em: entrada.atualizadoEm ?? painel.atualizadoEm ?? null,
    temperatura: inteiro(painel.agora.temperatura) != null ? `${inteiro(painel.agora.temperatura)}°C` : null,
    sensacao_termica: inteiro(painel.agora.sensacao) != null ? `${inteiro(painel.agora.sensacao)}°C` : null,
    chuva: textoChuva(chuva, temChuva),
    chuva_forte: textoChuvaForte(chuvaForteEvento, chuva, temChuva || temTextos),
    tempestade: textoTempestade(tempestade, temChuva || temTextos),
    vento: ventoPartes.length ? ventoPartes.join(" · ") : null,
    umidade: inteiro(painel.agora.umidade) != null ? `${inteiro(painel.agora.umidade)}%` : null,
    pressao: inteiro(painel.agora.pressao) != null ? `${inteiro(painel.agora.pressao)} hPa` : null,
    alertas,
    status: temAgora && (painel.chuva.length > 0 || painel.vento.length > 0) ? "sucesso" : "parcial",
    metodo_leitura: metodo,
    detalhes: {
      painel,
      chuva,
      vento,
      chuvaForte: chuvaForteEvento,
      tempestade,
    } satisfies DetalhesLeitura,
  };
}

/** Uma frase com o essencial da leitura (log e tela do administrador). */
export function resumirLeitura(l: Pick<LeituraAppa, "temperatura" | "vento" | "umidade" | "pressao" | "chuva">): string {
  return [
    l.temperatura,
    l.vento ? `vento ${l.vento.split(" · ")[0]}` : null,
    l.umidade ? `umidade ${l.umidade}` : null,
    l.pressao ? `pressão ${l.pressao}` : null,
    l.chuva,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Resumo das tabelas lidas, para o log: "chuva 12 · vento 12 · boletim 2". */
export function resumirPainel(p: PainelSimport): string {
  const partes = [
    p.agora.temperatura != null ? "agora" : null,
    p.chuva.length ? `chuva ${p.chuva.length}` : null,
    p.vento.length ? `vento ${p.vento.length}` : null,
    p.boletim.length ? `boletim ${p.boletim.length}` : null,
    p.mares.length ? `marés ${p.mares.length}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "sem dados";
}
