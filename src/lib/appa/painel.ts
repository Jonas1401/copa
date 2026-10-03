import { repararOcr, semAcento } from "./texto";
import type { PainelSimport } from "./tipos";

/**
 * Leitor do TEXTO do painel SIMPORT® – Dashboard Meteoceanográfico da APPA.
 *
 * Todos os métodos que veem a página (HTML, navegador automático, OCR e
 * Composio) acabam aqui: o texto entra, `PainelSimport` sai. O painel separa
 * cada célula em uma linha (markdown/HTML), mas o OCR devolve cada LINHA DA
 * TABELA numa linha só ("14:00 ◯ 6.4 mm 92%") e às vezes cola tudo
 * ("02:001.2mAlta"); por isso a leitura é por seção e tolerante ao layout.
 */

const RE_DIRECAO =
  /^(N|NNE|NNO|NE|ENE|E|ESE|SE|SSE|S|SSO|SSW|SO|SW|WSW|OSO|OSW|W|O|ONO|WNW|NW|NNW|L)$/i;
const RE_HORA_INICIO = /^(\d{1,2}):(\d{2})\b/;

const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
};
const horaPad = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
const horaValida = (h: string, m: string) => Number(h) <= 23 && Number(m) <= 59;

/** Uma linha do texto, sem marcas de markdown/tabela e (no OCR) com os erros típicos reparados. */
function limparLinha(l: string, ocr: boolean): string {
  const t = l
    .replace(/[#*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([:;,.!?])/g, "$1");
  return ocr ? repararOcr(t) : t;
}

/**
 * O painel escreve a chuva com UMA casa decimal ("0.2", "6.4", "< 0.1") e só o
 * zero vem sem ponto. No OCR o ponto some com facilidade ("6.4" vira "64"), e
 * "64 mm" numa hora seria um falso alarme de chuva forte: número de 2+ dígitos
 * sem ponto é lido como se o ponto tivesse sumido (errar para menos é seguro).
 */
export function mmDoOcr(bruto: string): number {
  if (!/[.,]/.test(bruto) && bruto.length >= 2) return num(`${bruto.slice(0, -1)}.${bruto.slice(-1)}`);
  return num(bruto);
}

/** Dia + horário informados pelo painel ("Atualizado em 03/10/2026 08:45"), em ISO. */
export function detectarAtualizacao(texto: string, agora: Date = new Date()): string | null {
  const m = texto.match(
    /(?:atualizad[oa]s?|[úu]ltima\s+atualiza[çc][ãa]o|dados\s+de)[^\d\n]{0,25}?(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?[^\d\n]{0,12}?)?(\d{1,2}):(\d{2})/i,
  );
  if (!m) return null;
  const [, d, mes, a, hh, mm] = m;
  if (!horaValida(hh, mm)) return null;
  const fuso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora); // AAAA-MM-DD
  const [ano0, mes0, dia0] = fuso.split("-");
  const ano = a ? (a.length === 2 ? `20${a}` : a) : ano0;
  const mesN = (mes ?? mes0).padStart(2, "0");
  const diaN = (d ?? dia0).padStart(2, "0");
  const iso = `${ano}-${mesN}-${diaN}T${horaPad(hh, mm)}:00-03:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : new Date(iso).toISOString();
}

/** Descarta o que não faz sentido físico (erro de OCR/layout) em vez de avisar um número impossível. */
export function sanearPainel(p: PainelSimport, opcoes: { ocr?: boolean } = {}): PainelSimport {
  const entre = (n: number | null, min: number, max: number) =>
    n != null && Number.isFinite(n) && n >= min && n <= max ? n : null;
  // Mais de 60 mm numa hora é raríssimo: no OCR, é muito mais provável um erro de leitura.
  const mmMax = opcoes.ocr ? 60 : 300;
  return {
    ...p,
    chuva: p.chuva.filter(
      (c) => Number.isFinite(c.mm) && c.mm >= 0 && c.mm <= mmMax && c.prob >= 0 && c.prob <= 100,
    ),
    vento: p.vento.filter((v) => Number.isFinite(v.nos) && v.nos >= 0 && v.nos <= 90),
    mares: p.mares.filter((m) => m.altura >= 0 && m.altura <= 8),
    agora: {
      ...p.agora,
      temperatura: entre(p.agora.temperatura, -15, 55),
      sensacao: entre(p.agora.sensacao, -25, 65),
      umidade: entre(p.agora.umidade, 0, 100),
      ventoNos: entre(p.agora.ventoNos, 0, 90),
      pressao: entre(p.agora.pressao, 850, 1100),
    },
  };
}

/**
 * Converte o texto do painel em dados comparáveis. Devolve null quando o
 * texto não parece ser o painel (vazio, erro, página de "carregando").
 * `ocr: true` liga os reparos de OCR e exige mais evidência.
 */
export function parsearPainelSimport(bruto: string, opcoes: { ocr?: boolean } = {}): PainelSimport | null {
  if (!bruto || bruto.trim().length < 60) return null;
  const ocr = Boolean(opcoes.ocr);
  // Células separadas por tab (innerText) ou por linha (markdown) viram uma linha cada.
  const todas = bruto.split(/\r?\n|\t/).map((l) => limparLinha(l, ocr));
  const linhas = todas.filter(Boolean);
  if (linhas.length < 5) return null;

  const norm = linhas.map((l) => semAcento(l).toLowerCase());
  const acha = (re: RegExp) => norm.findIndex((l) => re.test(l));
  // Títulos são linhas curtas: um parágrafo do boletim que cita "previsão de chuvas" não é título.
  const achaTitulo = (re: RegExp) => norm.findIndex((l, i) => linhas[i].length <= 70 && re.test(l));
  const fimDaSecao = (inicio: number, ...marcos: number[]) => {
    const proximos = marcos.filter((m) => m > inicio);
    return proximos.length ? Math.min(...proximos) : linhas.length;
  };

  const iChuva = achaTitulo(/^previsao\s*de\s*chuvas?\b/);
  const iVento = achaTitulo(/^previsao\s*de\s*ventos?\b/);
  const iMares = achaTitulo(/^previsao\s*de\s*mares?\b/);
  const iLua = achaTitulo(/^fases?\s*da\s*lua\b/);
  const iMapa = achaTitulo(/^mapa\s*de\s*localiza/);
  const iDiaVento = achaTitulo(/^direcao\s*do\s*vento\s*durante\s*o\s*dia\b/);

  /* ------------------------------------------ tabela de chuva (24 h) */
  const chuva: PainelSimport["chuva"] = [];
  if (iChuva >= 0) {
    const ate = fimDaSecao(iChuva, iVento, iMares, iLua, iMapa);
    for (let i = iChuva + 1; i < ate; i++) {
      const h = linhas[i].match(RE_HORA_INICIO);
      if (!h || !horaValida(h[1], h[2])) continue;
      let mm = Number.NaN;
      let prob = Number.NaN;
      const ler = (txt: string) => {
        const m = txt.match(/(\d+(?:[.,]\d+)?)\s*mm\b/i);
        if (m && Number.isNaN(mm)) mm = ocr ? mmDoOcr(m[1]) : num(m[1]);
        const p = txt.match(/(\d{1,3})\s*%/);
        if (p && Number.isNaN(prob)) prob = Number(p[1]);
      };
      // Linha de tabela inteira ("14:00 ◯ 6.4 mm 92%") ou uma célula por linha.
      ler(linhas[i].slice(h[0].length));
      for (let j = i + 1; j < Math.min(i + 5, ate); j++) {
        if (Number.isFinite(mm) && Number.isFinite(prob)) break;
        if (RE_HORA_INICIO.test(linhas[j])) break;
        ler(linhas[j]);
      }
      if (Number.isFinite(mm) || Number.isFinite(prob)) {
        chuva.push({
          hora: horaPad(h[1], h[2]),
          mm: Number.isFinite(mm) ? mm : 0,
          prob: Number.isFinite(prob) ? prob : 0,
        });
      }
    }
  }

  /* ------------------------------------------ tabela de vento (24 h) */
  const vento: PainelSimport["vento"] = [];
  if (iVento >= 0) {
    const ate = fimDaSecao(iVento, iDiaVento, iMares, iLua, iMapa);
    for (let i = iVento + 1; i < ate; i++) {
      const h = linhas[i].match(RE_HORA_INICIO);
      if (!h || !horaValida(h[1], h[2])) continue;
      let nos = Number.NaN;
      let direcao = "";
      const ler = (txt: string) => {
        const n = txt.match(/(\d+(?:[.,]\d+)?)\s*n[óo]s\b/i);
        if (n && Number.isNaN(nos)) nos = num(n[1]);
        const resto = n ? txt.replace(n[0], " ") : txt;
        for (const tk of resto.split(/\s+/)) {
          if (!direcao && RE_DIRECAO.test(tk)) direcao = tk.toUpperCase();
        }
      };
      ler(linhas[i].slice(h[0].length));
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (Number.isFinite(nos) && direcao) break;
        if (RE_HORA_INICIO.test(linhas[j])) break;
        ler(linhas[j]);
      }
      if (Number.isFinite(nos)) vento.push({ hora: horaPad(h[1], h[2]), nos, direcao });
    }
  }

  /* ------------------------------------------------------ marés */
  const mares: PainelSimport["mares"] = [];
  if (iMares >= 0) {
    const ate = fimDaSecao(iMares, iLua, iMapa);
    for (let i = iMares + 1; i < ate; i++) {
      // Formato colado do painel: "02:001.2mAlta".
      const cola = linhas[i].match(/(\d{1,2}:\d{2})\s*(\d+(?:[.,]\d+)?)\s*m\s*(alta|baixa)/i);
      if (cola) {
        mares.push({
          hora: cola[1],
          altura: num(cola[2]),
          tipo: cola[3].toLowerCase() === "alta" ? "alta" : "baixa",
        });
        continue;
      }
      const h = linhas[i].match(RE_HORA_INICIO);
      if (!h) continue;
      let altura = Number.NaN;
      let tipo = "";
      const ler = (txt: string) => {
        const a = txt.match(/(\d+(?:[.,]\d+)?)\s*m\b/i);
        if (a && Number.isNaN(altura)) altura = num(a[1]);
        const t = txt.match(/\b(alta|baixa)\b/i);
        if (t && !tipo) tipo = t[1].toLowerCase();
      };
      ler(linhas[i].slice(h[0].length));
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (Number.isFinite(altura) && tipo) break;
        if (RE_HORA_INICIO.test(linhas[j])) break;
        ler(linhas[j]);
      }
      if (Number.isFinite(altura) && tipo) {
        mares.push({ hora: horaPad(h[1], h[2]), altura, tipo: tipo === "alta" ? "alta" : "baixa" });
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
      if (/^\d{1,2}:\d{2}$/.test(linhas[j])) return linhas[j];
    }
    return null;
  };
  const nascerSol = horaPerto(/nascer do sol/);
  const porSol = horaPerto(/por do sol/);

  const boletim = lerBoletim(todas);

  /* --------------------------------------- medições do topo do painel */
  const primeiraSecao = Math.min(
    ...[iChuva, iVento, iMares, iLua, iMapa].filter((i) => i >= 0),
    linhas.length,
  );
  const iPrimeiroBoletim = linhas.findIndex((l) => RE_BOLETIM.test(l));
  const fimCab = Math.min(primeiraSecao, iPrimeiroBoletim >= 0 ? iPrimeiroBoletim : linhas.length, 16);
  const cab = linhas.slice(0, Math.max(fimCab, 1));

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

  const linhaGraus = linhas.slice(0, 20).find((l) => /^-?\d{1,2}(?:[.,]\d)?\s*°\s*C\b/i.test(l));
  const temperatura = linhaGraus ? num(linhaGraus.match(/^-?[\d.,]+/)![0]) : null;
  const sensacao = valorPerto(/sensacao termica/, /(-?\d+(?:[.,]\d+)?)\s*°?\s*C/i);

  let umidade = valorPerto(/^umidade\b|umidade\s*:/, /(\d+(?:[.,]\d+)?)\s*%/);
  if (umidade == null) {
    // OCR: os valores do cartão vêm numa linha só ("19°C 3.0 nós 86% 1017"), os rótulos na seguinte.
    const m = cab.join(" ").match(/(?<![\d.,])(\d{1,3})\s*%/);
    umidade = m ? Number(m[1]) : null;
  }

  let pressao = valorPerto(/^pressao\b|pressao\s*:/, /(\d+(?:[.,]\d+)?)/);
  if (pressao == null || pressao < 850 || pressao > 1100) {
    const m = cab.join(" ").match(/(?<![\d.,:])(\d{3,4}(?:[.,]\d)?)(?![\d:]|\s*(?:%|mm|n[óo]s|m\b|°))/);
    const n = m ? num(m[1]) : Number.NaN;
    pressao = Number.isFinite(n) && n >= 850 && n <= 1100 ? n : null;
  }

  // Vento atual: o primeiro "nós" do cartão do topo (antes dos boletins e das tabelas).
  const iVentoAtual = cab.findIndex((l) => /\d+(?:[.,]\d+)?\s*n[óo]s/i.test(l));
  let ventoAtual: number | null = null;
  let direcaoAtual: string | null = null;
  if (iVentoAtual >= 0) {
    const m = linhas[iVentoAtual].match(/(\d+(?:[.,]\d+)?)\s*n[óo]s/i)!;
    ventoAtual = num(m[1]);
    // O cartão sempre traz uma casa decimal ("3.0 nós"): sem ponto no OCR é o ponto que sumiu.
    if (ocr && !/[.,]/.test(m[1]) && m[1].length >= 2) ventoAtual = num(`${m[1].slice(0, -1)}.${m[1].slice(-1)}`);
    const depois = linhas[iVentoAtual].slice((m.index ?? 0) + m[0].length);
    const candidatos = [depois, linhas[iVentoAtual + 1] ?? "", linhas[iVentoAtual + 2] ?? ""];
    for (const c of candidatos) {
      const tk = c.trim().split(/\s+/)[0] ?? "";
      if (RE_DIRECAO.test(tk)) {
        direcaoAtual = tk.toUpperCase();
        break;
      }
    }
  }

  const painel: PainelSimport = {
    boletim,
    chuva,
    vento,
    mares,
    nascerSol,
    porSol,
    agora: {
      temperatura: Number.isFinite(temperatura ?? Number.NaN) ? temperatura : null,
      sensacao,
      umidade,
      ventoNos: Number.isFinite(ventoAtual ?? Number.NaN) ? ventoAtual : null,
      direcao: direcaoAtual,
      pressao,
    },
    atualizadoEm: detectarAtualizacao(linhas.join("\n")),
  };
  return sanearPainel(painel, { ocr });
}

/* ------------------------------------------------------------- boletim */
const RE_BOLETIM =
  /^(seg|ter|qua|qui|sex|s[áa]b|sab|dom)[a-zçã]*\.?\s*\((\d{1,2}\/\d{1,2})\)\s*:?\s*(.*)$/i;

/** Linhas que encerram o parágrafo de um boletim (título de seção ou célula de tabela). */
const RE_FIM_DE_BOLETIM =
  /^(previs[õo]es?|previs[ãa]o\s+de|hora\b|condi[çc][ãa]o\b|precipit|probabil|velocidade\b|dire[çc][ãa]o\b|pr[óo]ximas\b|mapa\s+de|dados\s+oceano|fases?\s+da\s+lua|\d{1,2}:\d{2}\b)/i;

/**
 * Boletins por dia ("Sáb (03/10): …"). O texto de um boletim pode quebrar em
 * várias linhas (OCR e `innerText` quebram onde a tela quebra): continua até
 * a linha em branco, o próximo dia ou o título da seção seguinte.
 */
function lerBoletim(todas: string[]): PainelSimport["boletim"] {
  const boletim: PainelSimport["boletim"] = [];
  for (let i = 0; i < todas.length; i++) {
    const m = todas[i].match(RE_BOLETIM);
    if (!m) continue;
    const partes = [(m[3] ?? "").trim()];
    for (let j = i + 1; j < Math.min(i + 12, todas.length); j++) {
      const l = todas[j];
      if (!l || RE_BOLETIM.test(l) || RE_FIM_DE_BOLETIM.test(l)) break;
      partes.push(l);
    }
    let texto = partes.join(" ").replace(/\s+/g, " ").trim();
    // Painel em markdown: o texto pode estar na linha seguinte ao rótulo do dia.
    if (!texto) texto = (todas.slice(i + 1).find(Boolean) ?? "").trim();
    if (texto.length > 15) boletim.push({ dia: m[2], texto });
  }
  return boletim;
}

/** O texto traz dados do painel? (usado pelos métodos para decidir se "leu" alguma coisa) */
export function leituraUtil(p: PainelSimport | null | undefined): boolean {
  if (!p) return false;
  return p.chuva.length > 0 || p.vento.length > 0 || p.boletim.length > 0 || p.agora.temperatura != null;
}

/** Tem a previsão (tabelas) ou o boletim, não só o cartão com o tempo de agora. */
export function leituraCompleta(p: PainelSimport | null | undefined): boolean {
  if (!p) return false;
  return p.chuva.length > 0 || p.vento.length > 0 || p.boletim.length > 0;
}

/**
 * O OCR erra mais do que os outros métodos: só vale com evidência de sobra
 * (uma tabela de 3+ linhas, ou temperatura junto com umidade/vento).
 */
export function leituraUtilOcr(p: PainelSimport | null | undefined): boolean {
  if (!p) return false;
  if (p.chuva.length >= 3 || p.vento.length >= 3) return true;
  return p.agora.temperatura != null && (p.agora.umidade != null || p.agora.ventoNos != null);
}
