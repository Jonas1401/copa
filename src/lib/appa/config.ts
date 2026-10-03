import { ORDEM_METODOS, ehMetodo, type MetodoLeitura } from "./tipos";

/**
 * Configuração da leitura do painel da APPA (variáveis de ambiente, todas
 * opcionais — os padrões já funcionam).
 */

export const URL_PAINEL_PADRAO = "https://weather-appa.app.simport.com.br/";

/** Endereço do painel público (pode ser trocado por SIMPORT_PAINEL_URL). */
export const urlPainel = (env: Record<string, string | undefined> = process.env) =>
  env.SIMPORT_PAINEL_URL?.trim() || URL_PAINEL_PADRAO;

const DESLIGADO = new Set(["0", "off", "false", "nao", "não", "desligado"]);

/**
 * Métodos ligados, SEMPRE na ordem do fallback (API → HTML → navegador → OCR →
 * Composio). `APPA_METODOS=api,html` liga só esses; `APPA_NAVEGADOR=0` desliga
 * o navegador automático e o OCR (que depende da captura de tela).
 */
export function metodosLigados(env: Record<string, string | undefined> = process.env): MetodoLeitura[] {
  const lista = String(env.APPA_METODOS ?? "")
    .split(/[\s,;]+/)
    .map((m) => m.trim().toLowerCase())
    .filter(ehMetodo);
  const base = lista.length ? ORDEM_METODOS.filter((m) => lista.includes(m)) : [...ORDEM_METODOS];
  const semNavegador = DESLIGADO.has(String(env.APPA_NAVEGADOR ?? "1").trim().toLowerCase());
  return semNavegador ? base.filter((m) => m !== "playwright" && m !== "ocr") : base;
}

const seg = (v: unknown, padrao: number, min: number, max: number) => {
  const n = Number(String(v ?? "").trim());
  return (Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, min), max) : padrao) * 1000;
};

export type ConfigLeitor = {
  /** Tempo máximo de cada método (ms). */
  timeouts: Record<MetodoLeitura, number>;
  /** Tempo total do ciclo de leitura (ms): o cron tem 60 s e ainda faz outras coisas. */
  orcamentoMs: number;
  /** Orçamento do caminho leve (app aberto), em ms. */
  orcamentoLeveMs: number;
};

export function configLeitor(env: Record<string, string | undefined> = process.env): ConfigLeitor {
  return {
    timeouts: {
      api: seg(env.APPA_TIMEOUT_API_SEG, 10, 2, 30),
      html: seg(env.APPA_TIMEOUT_HTML_SEG, 9, 2, 30),
      playwright: seg(env.APPA_TIMEOUT_NAVEGADOR_SEG, 22, 5, 55),
      ocr: seg(env.APPA_TIMEOUT_OCR_SEG, 16, 5, 55),
      composio: seg(env.APPA_TIMEOUT_COMPOSIO_SEG, 12, 3, 30),
    },
    orcamentoMs: seg(env.APPA_ORCAMENTO_SEG, 32, 5, 55),
    orcamentoLeveMs: seg(env.APPA_ORCAMENTO_LEVE_SEG, 7, 3, 20),
  };
}
