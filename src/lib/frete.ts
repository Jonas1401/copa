/**
 * Cálculo de Frete — leitura do ticket "2ª Via de Tickets" (Copadubo).
 *
 * Mesma regra do Frete Fácil:
 *   frete de cada carga = Quant (toneladas) × Valor (R$ por tonelada)
 *   frete bruto         = soma das cargas
 *   ganho do motorista  = frete bruto × porcentagem
 *
 * Dois leitores:
 *   - por COORDENADAS (palavras da foto com posição x/y): acha as colunas
 *     "Quant" e "Valor" pelo cabeçalho e casa os números linha a linha.
 *   - por TEXTO (colado/digitado ou o texto cru do OCR), como reserva.
 */

export type Carga = {
  id: string;
  ponto?: string;
  quant: number; // toneladas
  valor: number; // R$ por tonelada
  subtotal: number; // quant × valor
  linha: string;
  confianca: "alta" | "media";
};

export type Leitura = {
  cargas: Carga[];
  ponto: string;
  /** Linhas que parecem carga mas saíram ilegíveis (para o motorista corrigir). */
  problemas?: string[];
};

export type Calculo = {
  id: string;
  criadoEm: number;
  ponto?: string;
  cargas: Carga[];
  bruto: number;
  toneladas: number;
  porcentagem: number;
  ganho: number;
};

export const PORCENTAGENS = [15, 16, 17, 18, 19, 20, 21, 22];

export const EXEMPLO_TEXTO = `Ponto  Quant   Valor
A032   29.920  17.29
A032   32.140  17.29
A032   30.000  21.12`;

/* ------------------------------------------------------------ formatos */
export const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(v) ? v : 0);

export const num = (v: number, casas = 2) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: casas }).format(
    Number.isFinite(v) ? v : 0,
  );

/** Toneladas no padrão do ticket: 571.760 */
export const toneladas = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(v) ? v : 0);

/** "18", "18,5", "18%" → número entre 0 e 100 (ou null). */
export function lerPorcentagem(texto: string): number | null {
  const n = Number(texto.replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/**
 * Número lido do ticket. Corrige trocas comuns do OCR (O→0, I/l→1, S→5) e
 * entende "29.920" / "29,920" como 29,92 toneladas e "17.29" como R$ 17,29.
 */
export function lerNumero(texto: string): number | null {
  let t = texto
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[^0-9.,]/g, "");
  if (!t || !/\d/.test(t)) return null;
  if (t.includes(".") && t.includes(",")) {
    const ult = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    t = `${t.slice(0, ult).replace(/[.,]/g, "")}.${t.slice(ult + 1)}`;
  } else if (t.includes(",")) {
    const partes = t.split(",");
    if (partes.length === 2) t = `${partes[0]}.${partes[1]}`;
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Quant no ticket: 29.920 (toneladas com 3 casas). */
const FORMATO_QUANT = /^\d{1,2}[.,]\d{3}$/;
/** Valor no ticket: 17.29 (R$ por tonelada, 1 ou 2 casas). */
const FORMATO_VALOR = /^\d{1,3}[.,]\d{1,2}$/;
const valorPlausivel = (v: number) => v >= 1 && v <= 150;
const quantPlausivel = (q: number) => q >= 0.5 && q <= 80;

const ehData = (t: string) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t);
const ehHora = (t: string) => /^\d{1,2}:\d{2}/.test(t);
const ehRodape = (t: string) =>
  /total|geral|motorista|viagen|emiss|periodo|período/i.test(t);
const pareceNumero = (t: string) =>
  /^\d{1,3}([.,]\d{1,3})?$/.test(t.replace(/[OoIl|Ss]/g, "0").replace(/[^0-9.,]/g, ""));

const maisFrequente = (lista: string[]) => {
  const conta = new Map<string, number>();
  for (const v of lista) if (v.length >= 2) conta.set(v, (conta.get(v) ?? 0) + 1);
  let melhor = "";
  let max = 0;
  for (const [v, n] of conta) if (n > max) [melhor, max] = [v, n];
  return melhor;
};

/* ------------------------------------------------- leitura por coordenadas */
export type Palavra = {
  texto: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  xc: number;
  yc: number;
};

export function lerPorCoordenadas(palavras: Palavra[]): Leitura {
  if (!palavras.length) return { cargas: [], ponto: "" };

  let cabQuant: Palavra | null = null;
  let cabValor: Palavra | null = null;
  let cabPonto: Palavra | null = null;
  for (const p of palavras) {
    const t = p.texto.toLowerCase().trim();
    if (/^quant/.test(t) && !cabQuant) cabQuant = p;
    if (/^valor/.test(t) && !cabValor) cabValor = p;
    if (/^ponto/.test(t) && !cabPonto) cabPonto = p;
  }
  if (!cabQuant || !cabValor) return { cargas: [], ponto: "" };

  const faixa = (c: Palavra) => {
    const larg = Math.max(c.x1 - c.x0, 40);
    return { min: c.xc - larg, max: c.xc + larg };
  };
  const fQuant = faixa(cabQuant);
  const fValor = faixa(cabValor);
  const fPonto = cabPonto ? faixa(cabPonto) : null;

  const topo = Math.max(cabQuant.y1, cabValor.y1);
  let fundo = Infinity;
  for (const p of palavras) if (ehRodape(p.texto) && p.y0 > topo && p.y0 < fundo) fundo = p.y0;

  const quants: Palavra[] = [];
  const valores: Palavra[] = [];
  const pontos: Palavra[] = [];
  for (const p of palavras) {
    if (p.yc <= topo || p.yc >= fundo) continue;
    if (ehData(p.texto) || ehHora(p.texto) || ehRodape(p.texto)) continue;
    if (fPonto && p.xc >= fPonto.min && p.xc <= fPonto.max) {
      pontos.push(p);
      continue;
    }
    if (!pareceNumero(p.texto)) continue;
    if (p.xc >= fQuant.min && p.xc <= fQuant.max) quants.push(p);
    else if (p.xc >= fValor.min && p.xc <= fValor.max) valores.push(p);
  }

  const ponto = maisFrequente(pontos.map((p) => p.texto.trim().toUpperCase()));
  quants.sort((a, b) => a.yc - b.yc);
  valores.sort((a, b) => a.yc - b.yc);

  const usados = new Set<number>();
  const TOL = 25;
  const cargas: Carga[] = [];
  for (const q of quants) {
    let melhor = -1;
    let dist = TOL;
    valores.forEach((v, i) => {
      if (usados.has(i)) return;
      const d = Math.abs(q.yc - v.yc);
      if (d < dist) [dist, melhor] = [d, i];
    });
    if (melhor < 0) continue;
    usados.add(melhor);
    const quant = lerNumero(q.texto);
    const valor = lerNumero(valores[melhor].texto);
    if (quant === null || valor === null) continue;
    if (!quantPlausivel(quant) || !valorPlausivel(valor)) continue;
    if (!FORMATO_VALOR.test(valores[melhor].texto.replace(/[^0-9.,]/g, ""))) continue;

    let pontoLinha = ponto;
    let dp = TOL;
    for (const p of pontos) {
      const d = Math.abs(q.yc - p.yc);
      if (d < dp) [dp, pontoLinha] = [d, p.texto.trim().toUpperCase()];
    }
    cargas.push({
      id: `c-${cargas.length}-${quant}-${valor}`,
      ponto: pontoLinha || undefined,
      quant,
      valor,
      subtotal: quant * valor,
      linha: `${q.texto}  ${valores[melhor].texto}`,
      confianca: "alta",
    });
  }
  return { cargas, ponto };
}

/* ------------------------------------------------------ leitura por texto */
/**
 * Linha a linha, no formato do ticket: [Ponto] Quant Valor ...
 *   "A032 29.920 17.29 FRETE ATE 5 KM 14/09/2026 21:00"
 *   "27.120   21.52"            (digitado)
 * Não depende de espaços duplos entre colunas.
 */
export function lerPorTexto(texto: string): Leitura {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cargas: Carga[] = [];
  const problemas: string[] = [];
  const pontos: string[] = [];

  linhas.forEach((l, i) => {
    if (ehRodape(l) || /quant|valor|via\s+de\s+ticket/i.test(l)) return;
    const tokens = l.split(/\s+/).filter((t) => !ehData(t) && !ehHora(t));
    const iq = tokens.findIndex((t) => FORMATO_QUANT.test(t));
    if (iq < 0) return;
    const quant = lerNumero(tokens[iq]);
    if (quant === null || !quantPlausivel(quant)) return;

    const pm = l.match(/\b([ABM])\s?(\d{2,3})\b/i);
    const ponto = pm ? `${pm[1].toUpperCase()}${pm[2].padStart(3, "0")}` : undefined;

    const tv = tokens[iq + 1] ?? "";
    const valor = FORMATO_VALOR.test(tv) ? lerNumero(tv) : null;
    if (valor === null || !valorPlausivel(valor)) {
      problemas.push(`${ponto ? ponto + " " : ""}${tokens[iq]} — valor ilegível ("${tv || "?"}")`);
      return;
    }
    if (ponto) pontos.push(ponto);
    cargas.push({
      id: `t-${i}-${quant}-${valor}`,
      ponto,
      quant,
      valor,
      subtotal: quant * valor,
      linha: l,
      confianca: "alta",
    });
  });
  if (cargas.length || problemas.length) {
    return { cargas, ponto: maisFrequente(pontos), problemas };
  }

  // Reserva para texto livre: pares de números por linha (o maior é o peso).
  const re = /\d{1,3}(?:[.,]\d{1,3})?/g;
  linhas.forEach((l, i) => {
    if (/total|motorista|viagen|emiss|periodo|frete\s+ate|via\s+de\s+ticket/i.test(l)) return;
    const nums = (l.match(re) ?? [])
      .map(lerNumero)
      .filter((n): n is number => n !== null);
    for (let k = 0; k < nums.length - 1; k++) {
      const [a, b] = [nums[k], nums[k + 1]];
      const [q, v] = a > b ? [a, b] : [b, a];
      if (quantPlausivel(q) && valorPlausivel(v)) {
        cargas.push({
          id: `p-${i}-${k}`,
          quant: q,
          valor: v,
          subtotal: q * v,
          linha: l,
          confianca: "media",
        });
        k++;
      }
    }
  });
  return { cargas, ponto: "" };
}

/**
 * Escolhe a melhor leitura: a que bate com o TOTAL GERAL do ticket; senão a
 * que achou mais cargas (empate: a com menos linhas ilegíveis).
 */
export function escolherLeitura(
  opcoes: Leitura[],
  total: { viagens: number; tons: number } | null,
): Leitura {
  const validas = opcoes.filter((o) => o.cargas.length > 0);
  if (!validas.length) return opcoes[0] ?? { cargas: [], ponto: "" };
  if (total) {
    const bate = validas.find(
      (o) =>
        o.cargas.length === total.viagens &&
        Math.abs(o.cargas.reduce((s, c) => s + c.quant, 0) - total.tons) < 0.01,
    );
    if (bate) return bate;
  }
  return [...validas].sort(
    (a, b) =>
      b.cargas.length - a.cargas.length ||
      (a.problemas?.length ?? 0) - (b.problemas?.length ?? 0),
  )[0];
}

/** "TOTAL GERAL: 19 VIAGENS - 571.760 TONS" → { viagens: 19, tons: 571.76 } */
export function lerTotalDoTicket(texto: string) {
  const m = texto.match(/(\d{1,4})\s*viagens?\s*[-–]\s*([\d.,]+)\s*tons?/i);
  if (!m) return null;
  const tons = lerNumero(m[2]);
  return tons === null ? null : { viagens: Number(m[1]), tons };
}

export function calcular(leitura: Leitura, porcentagem: number): Calculo {
  const bruto = leitura.cargas.reduce((s, c) => s + c.subtotal, 0);
  const tons = leitura.cargas.reduce((s, c) => s + c.quant, 0);
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    criadoEm: Date.now(),
    ponto: leitura.ponto || undefined,
    cargas: leitura.cargas,
    bruto,
    toneladas: tons,
    porcentagem,
    ganho: bruto * (porcentagem / 100),
  };
}

export function textoWhatsApp(c: Calculo) {
  const linhas = ["🚛 *Frete Fácil · CopaLinks*", ""];
  if (c.ponto) linhas.push(`📍 Ponto: ${c.ponto}`);
  linhas.push(
    `🚚 Cargas: ${c.cargas.length} · ${toneladas(c.toneladas)} t`,
    `📦 Frete bruto: ${brl(c.bruto)}`,
    `📈 Comissão: ${num(c.porcentagem)}%`,
    `💰 Ganho líquido: ${brl(c.ganho)}`,
  );
  return linhas.join("\n");
}
