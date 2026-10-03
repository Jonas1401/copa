import { normalizarLeitura } from "./analise";
import { configLeitor, metodosLigados, urlPainel } from "./config";
import { lerViaApi } from "./metodos/api";
import { lerViaComposio } from "./metodos/composio";
import { lerViaHtml } from "./metodos/html";
import { capturarPagina, lerViaNavegador, type AbridorDePagina, type CapturaNavegador } from "./metodos/navegador";
import { capturaExterna, lerViaOcr, type Reconhecedor } from "./metodos/ocr";
import { leituraCompleta, leituraUtil } from "./painel";
import {
  ErroMetodo,
  METODOS_LEVES,
  ORDEM_METODOS,
  ROTULO_METODO,
  type MetodoLeitura,
  type ResultadoLeitura,
  type SaidaMetodo,
  type TentativaLeitura,
} from "./tipos";

/**
 * LEITOR DO PAINEL DA APPA — vários métodos com fallback automático.
 *
 * O painel (https://weather-appa.app.simport.com.br/) é lido SEMPRE pelo
 * servidor, nesta ordem, parando no primeiro método que trouxer os dados:
 *
 *   1. API      — os endpoints JSON do SIMPORT (a fonte de onde a página bebe);
 *   2. HTML     — HTTP direto na página (texto, tabelas, JSON incorporado);
 *   3. Navegador automático — Playwright/Chromium: espera o JavaScript montar a
 *               página, rola, captura texto, tabelas e as respostas JSON;
 *   4. OCR      — captura de tela do painel + tesseract.js;
 *   5. Composio — método ADICIONAL (a ferramenta não roda JavaScript e costuma
 *               voltar vazia com este painel). Nunca é o único caminho.
 *
 * Resultado vazio, texto vazio, erro ou timeout de um método só viram uma linha
 * do log e o próximo método assume — nada disso aparece como falha. Só quando
 * TODOS falham o resultado é `erro`, com o motivo de cada tentativa. O que
 * sai daqui é sempre o formato normalizado (`LeituraAppa`).
 */

const FUSO = "America/Sao_Paulo";
const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const duracao = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const ROTULO_RESULTADO: Record<TentativaLeitura["resultado"], string> = {
  sucesso: "SUCESSO",
  parcial: "PARCIAL",
  falhou: "FALHOU",
  vazio: "VAZIO",
  indisponivel: "INDISPONÍVEL",
  pulado: "PULADO",
};

/** Linha do log de diagnóstico: "[09:15:02] APPA · #1 API · SUCESSO · 812 ms · chuva 12 · vento 12". */
export function formatarLinhaLog(t: Omit<TentativaLeitura, "linha">): string {
  const hora = FORMATO_HORA.format(new Date(t.inicio));
  return `[${hora}] APPA · #${t.ordem} ${ROTULO_METODO[t.metodo]} · ${ROTULO_RESULTADO[t.resultado]} · ${duracao(t.duracaoMs)} · ${t.detalhe}`;
}

/* --------------------------------------------------------------- contexto */
export type ContextoLeitura = {
  url: string;
  /** Tempo que este método ainda pode gastar. */
  timeoutMs: number;
  agora: Date;
  /** Captura do navegador (abre uma vez; os métodos 3 e 4 compartilham). */
  captura: () => Promise<CapturaNavegador>;
  /** A captura, se já terminou com sucesso (o OCR não espera por ela). */
  capturaPronta: () => CapturaNavegador | null;
  /** Por que não há captura (para o log do OCR). */
  motivoSemCaptura: () => string | null;
  /** Troca o Tesseract (testes). */
  reconhecedorOcr?: { reconhecer: Reconhecedor; encerrar?: () => Promise<void> };
};

export type ExecutorMetodo = (ctx: ContextoLeitura) => Promise<SaidaMetodo>;

const EXECUTORES: Record<MetodoLeitura, ExecutorMetodo> = {
  api: (ctx) => lerViaApi({ timeoutMs: ctx.timeoutMs }),
  html: (ctx) => lerViaHtml({ url: ctx.url, timeoutMs: ctx.timeoutMs }),
  playwright: async (ctx) => lerViaNavegador(await ctx.captura(), ctx.agora.getTime()),
  ocr: async (ctx) => {
    let screenshot = ctx.capturaPronta()?.screenshot ?? null;
    let motivo = ctx.motivoSemCaptura() ?? undefined;
    if (!screenshot) {
      try {
        screenshot = await capturaExterna(ctx.url, Math.min(ctx.timeoutMs / 2, 12_000));
      } catch (e) {
        motivo = `serviço de captura: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return lerViaOcr({ screenshot, timeoutMs: ctx.timeoutMs, motivoSemImagem: motivo, reconhecedor: ctx.reconhecedorOcr });
  },
  composio: (ctx) => lerViaComposio({ timeoutMs: ctx.timeoutMs }),
};

/** Promessa com prazo: o método que travar não trava o ciclo. */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new ErroMetodo(`tempo esgotado (${Math.round(ms / 1000)} s)`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

const logConsole = (linha: string) => {
  if (process.env.APPA_LOG === "0") return;
  console.info(`[appa] ${linha}`);
};

export type OpcoesLeitura = {
  /**
   * Caminho LEVE (o app aberto bate no radar e não pode esperar): só API e HTML
   * e um orçamento curto. Navegador, OCR e Composio ficam para o cron.
   */
  leve?: boolean;
  orcamentoMs?: number;
  /** Restringe os métodos (testes, diagnóstico). A ordem do fallback é sempre a mesma. */
  metodos?: MetodoLeitura[];
  /** Troca a implementação de métodos (testes). */
  executores?: Partial<Record<MetodoLeitura, ExecutorMetodo>>;
  agora?: Date;
  /** Para onde vai cada linha do log (padrão: console; `APPA_LOG=0` silencia). */
  log?: (linha: string) => void;
  /** Trocam o navegador e o Tesseract reais (testes). */
  abrirNavegador?: AbridorDePagina;
  reconhecedorOcr?: ContextoLeitura["reconhecedorOcr"];
};

/**
 * Lê o painel da APPA pelo primeiro método que funcionar. Nunca joga erro.
 */
export async function lerPainelAppa(opcoes: OpcoesLeitura = {}): Promise<ResultadoLeitura> {
  const inicioCiclo = Date.now();
  const tentativas: TentativaLeitura[] = [];
  const escrever = opcoes.log ?? logConsole;
  try {
    const cfg = configLeitor();
    const limite = inicioCiclo + (opcoes.orcamentoMs ?? (opcoes.leve ? cfg.orcamentoLeveMs : cfg.orcamentoMs));
    const ligados = opcoes.metodos ?? metodosLigados();
    const fila = ORDEM_METODOS.filter((m) => ligados.includes(m));
    const executores = { ...EXECUTORES, ...(opcoes.executores ?? {}) };
    const url = urlPainel();
    const agora = opcoes.agora ?? new Date();

    // Navegador: abre uma vez e os métodos 3 (texto) e 4 (OCR) dividem a captura.
    let pendente: Promise<CapturaNavegador> | null = null;
    let pronta: CapturaNavegador | null = null;
    let motivoCaptura: string | null = null;
    let timeoutCaptura = cfg.timeouts.playwright;
    const captura = () => {
      if (!pendente) {
        pendente = capturarPagina({
          url,
          timeoutMs: timeoutCaptura,
          screenshot: fila.includes("ocr"),
          abrir: opcoes.abrirNavegador,
        });
        pendente.then(
          (c) => {
            pronta = c;
          },
          (e) => {
            motivoCaptura = e instanceof Error ? e.message : String(e);
          },
        );
      }
      return pendente;
    };

    const registrar = (
      ordem: number,
      metodo: MetodoLeitura,
      inicio: number,
      resultado: TentativaLeitura["resultado"],
      detalhe: string,
    ) => {
      const base = {
        ordem,
        metodo,
        inicio: new Date(inicio).toISOString(),
        duracaoMs: Date.now() - inicio,
        resultado,
        detalhe: detalhe.replace(/\s+/g, " ").trim().slice(0, 400),
      };
      const t: TentativaLeitura = { ...base, linha: formatarLinhaLog(base) };
      tentativas.push(t);
      escrever(t.linha);
    };

    let parcial: { saida: SaidaMetodo; metodo: MetodoLeitura } | null = null;
    for (const [i, metodo] of fila.entries()) {
      const ordem = i + 1;
      const inicio = Date.now();
      // Caminho leve (app aberto): navegador, OCR e Composio ficam para o cron — sem barulho no log.
      if (opcoes.leve && !METODOS_LEVES.includes(metodo)) continue;
      const restante = limite - Date.now();
      if (restante < 1500) {
        registrar(ordem, metodo, inicio, "pulado", "o orçamento de tempo do ciclo acabou");
        continue;
      }
      const timeoutMs = Math.min(cfg.timeouts[metodo], restante);
      if (metodo === "playwright") timeoutCaptura = timeoutMs;
      try {
        const saida = await comPrazo(
          executores[metodo]({
            url,
            timeoutMs,
            agora,
            captura,
            capturaPronta: () => pronta,
            motivoSemCaptura: () => motivoCaptura,
            reconhecedorOcr: opcoes.reconhecedorOcr,
          }),
          timeoutMs + 1500,
        );
        const efetivo = saida.metodoEfetivo ?? metodo;
        const nota = efetivo !== metodo ? ` (lido pelo método ${ROTULO_METODO[efetivo]})` : "";
        if (leituraCompleta(saida.painel)) {
          registrar(ordem, metodo, inicio, "sucesso", `${saida.resumo}${nota}`);
          const leitura = normalizarLeitura({
            painel: saida.painel,
            metodo: efetivo,
            em: agora,
            atualizadoEm: saida.atualizadoEm,
            sinais: saida.sinais,
          });
          return {
            status: leitura.status,
            leitura,
            metodo: efetivo,
            tentativas,
            erro: null,
            duracaoMs: Date.now() - inicioCiclo,
            leve: opcoes.leve,
          };
        }
        if (leituraUtil(saida.painel)) {
          registrar(ordem, metodo, inicio, "parcial", `${saida.resumo}${nota} — sem as tabelas de previsão, segue para o próximo método`);
          parcial ??= { saida, metodo: efetivo };
          continue;
        }
        throw new ErroMetodo("a resposta não traz dados do painel", "vazio");
      } catch (e) {
        const tipo = e instanceof ErroMetodo ? e.tipo : "falhou";
        registrar(ordem, metodo, inicio, tipo, e instanceof Error ? e.message : String(e));
      }
    }

    // Nenhum método trouxe a previsão completa: vale a melhor leitura parcial (ex.: só o tempo de agora).
    if (parcial) {
      const leitura = normalizarLeitura({
        painel: parcial.saida.painel,
        metodo: parcial.metodo,
        em: agora,
        atualizadoEm: parcial.saida.atualizadoEm,
        sinais: parcial.saida.sinais,
      });
      return {
        status: "parcial",
        leitura: { ...leitura, status: "parcial" },
        metodo: parcial.metodo,
        tentativas,
        erro: null,
        duracaoMs: Date.now() - inicioCiclo,
        leve: opcoes.leve,
      };
    }

    const motivos = tentativas
      .filter((t) => t.resultado !== "pulado")
      .map((t) => `${ROTULO_METODO[t.metodo]}: ${t.detalhe}`);
    const erro = fila.length
      ? `Nenhum método conseguiu ler o painel da APPA — ${motivos.join(" | ") || "todos foram pulados"}`
      : "Nenhum método de leitura do painel está ligado (APPA_METODOS).";
    return {
      status: "erro",
      leitura: null,
      metodo: null,
      tentativas,
      erro: erro.slice(0, 900),
      duracaoMs: Date.now() - inicioCiclo,
      leve: opcoes.leve,
    };
  } catch (e) {
    const erro = `falha inesperada na leitura do painel: ${e instanceof Error ? e.message : String(e)}`;
    return { status: "erro", leitura: null, metodo: null, tentativas, erro, duracaoMs: Date.now() - inicioCiclo };
  }
}
