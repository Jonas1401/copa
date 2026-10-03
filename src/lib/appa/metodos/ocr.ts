import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resumirPainel } from "../analise";
import { leituraCompleta, leituraUtilOcr, parsearPainelSimport } from "../painel";
import { ErroMetodo, type PainelSimport, type SaidaMetodo } from "../tipos";
import { resolverDoProjeto } from "./navegador";

/**
 * MÉTODO 4 — captura de tela + OCR.
 *
 * Último recurso antes do Composio: se nenhum método anterior conseguiu os
 * dados (nem a API, nem o HTML, nem o texto renderizado pelo navegador), lê a
 * IMAGEM do painel com OCR (tesseract.js) e normaliza o texto: chuva, chuva
 * forte, tempestade, vento e velocidade, temperatura, pressão, umidade,
 * previsão, horários e alertas. A imagem vem da captura do navegador
 * automático ou, sem navegador, de um serviço de captura (APPA_SCREENSHOT_URL).
 *
 * O OCR erra mais que os outros métodos: os reparos de leitura e a checagem de
 * plausibilidade ficam em `painel.ts`/`texto.ts` e a leitura só é aceita com
 * evidência de sobra (`leituraUtilOcr`).
 */

export type Reconhecedor = (png: Buffer, psm: "4" | "6") => Promise<string>;

/** Pasta com o `por.traineddata.gz` (pacote @tesseract.js-data/por ou APPA_OCR_LANG_PATH). */
export function pastaDoIdioma(env: Record<string, string | undefined> = process.env): string | null {
  const manual = env.APPA_OCR_LANG_PATH?.trim();
  if (manual && existsSync(manual)) return manual;
  try {
    const pacote = dirname(resolverDoProjeto("@tesseract.js-data/por/package.json"));
    const pasta = join(pacote, "4.0.0_best_int");
    return existsSync(join(pasta, "por.traineddata.gz")) ? pasta : null;
  } catch {
    return null;
  }
}

/** Escala de cinza + contraste (e ampliação se a imagem for estreita), para o OCR ler melhor. */
async function prepararImagem(png: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(png).metadata();
    let img = sharp(png).grayscale().normalize();
    if ((meta.width ?? 0) > 0 && (meta.width ?? 0) < 1100) img = img.resize({ width: Math.round((meta.width ?? 800) * 1.6), kernel: "lanczos3" });
    // Páginas muito altas (milhares de pixels) deixam o OCR lento: lê só o começo, onde está o painel.
    if ((meta.height ?? 0) > 9000) img = img.extract({ left: 0, top: 0, width: meta.width ?? 1280, height: 9000 });
    return await img.png().toBuffer();
  } catch {
    return png; // sem o sharp, o Tesseract lê a imagem como veio
  }
}

/** Reconhecedor padrão: tesseract.js em português, com o worker criado e encerrado a cada leitura. */
export function criarReconhecedorTesseract(): { reconhecer: Reconhecedor; encerrar: () => Promise<void> } {
  let worker: import("tesseract.js").Worker | null = null;
  let psmAtual = "";
  const iniciar = async () => {
    if (worker) return worker;
    const { createWorker } = await import("tesseract.js");
    const langPath = pastaDoIdioma();
    worker = await createWorker("por", 1, {
      ...(langPath ? { langPath, gzip: true, cacheMethod: "none" } : { cachePath: tmpdir() }),
      logger: () => undefined,
    });
    return worker;
  };
  return {
    async reconhecer(png, psm) {
      const w = await iniciar();
      if (psmAtual !== psm) {
        await w.setParameters({ tessedit_pageseg_mode: psm as unknown as import("tesseract.js").PSM, preserve_interword_spaces: "1" });
        psmAtual = psm;
      }
      const { data } = await w.recognize(png);
      return data.text ?? "";
    },
    async encerrar() {
      const w = worker;
      worker = null;
      await w?.terminate().catch(() => null);
    },
  };
}

/** Serviço de captura de tela externo (APPA_SCREENSHOT_URL, com {url} no lugar do endereço do painel). */
export async function capturaExterna(urlPainel: string, timeoutMs: number): Promise<Buffer | null> {
  const modelo = process.env.APPA_SCREENSHOT_URL?.trim();
  if (!modelo) return null;
  const alvo = modelo.replace("{url}", encodeURIComponent(urlPainel));
  const r = await fetch(alvo, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`o serviço de captura respondeu HTTP ${r.status}`);
  const tipo = r.headers.get("content-type") ?? "";
  if (/^image\//i.test(tipo)) return Buffer.from(await r.arrayBuffer());
  if (/json/i.test(tipo)) {
    const j = (await r.json()) as { data?: { screenshot?: { url?: string } }; screenshot?: { url?: string }; url?: string };
    const u = j?.data?.screenshot?.url ?? j?.screenshot?.url ?? j?.url;
    if (typeof u === "string") {
      const img = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (img.ok) return Buffer.from(await img.arrayBuffer());
    }
  }
  throw new Error("o serviço de captura não devolveu uma imagem");
}

export async function lerViaOcr(opcoes: {
  /** PNG da captura de tela do painel (do navegador automático ou do serviço externo). */
  screenshot: Buffer | null;
  timeoutMs: number;
  /** Troca o Tesseract (testes). */
  reconhecedor?: { reconhecer: Reconhecedor; encerrar?: () => Promise<void> };
  motivoSemImagem?: string;
}): Promise<SaidaMetodo> {
  if (!opcoes.screenshot || opcoes.screenshot.length < 2000) {
    throw new ErroMetodo(
      `sem captura de tela para o OCR (${opcoes.motivoSemImagem ?? "o navegador automático não gerou a imagem"})`,
      "indisponivel",
    );
  }
  const inicio = Date.now();
  const restante = () => opcoes.timeoutMs - (Date.now() - inicio);
  const motor = opcoes.reconhecedor ?? criarReconhecedorTesseract();
  try {
    const imagem = await prepararImagem(opcoes.screenshot);
    let melhor: PainelSimport | null = null;
    let ultimoTexto = "";
    // Layout em colunas e layout em linhas pedem modos diferentes do Tesseract: tenta os dois se sobrar tempo.
    for (const psm of ["4", "6"] as const) {
      if (melhor && restante() < 6000) break;
      if (restante() < 3000) break;
      ultimoTexto = await motor.reconhecer(imagem, psm);
      const painel = parsearPainelSimport(ultimoTexto, { ocr: true });
      if (painel && leituraUtilOcr(painel)) {
        melhor = painel;
        if (leituraCompleta(painel)) break;
      }
    }
    if (!melhor) {
      throw new ErroMetodo(
        `o OCR leu ${ultimoTexto.trim().length} caracteres, mas não reconheceu os dados do painel (chuva, vento, temperatura…)`,
        "vazio",
      );
    }
    return {
      painel: melhor,
      atualizadoEm: melhor.atualizadoEm ?? null,
      resumo: `${resumirPainel(melhor)} · lido por OCR em ${Math.round((Date.now() - inicio) / 100) / 10} s`,
    };
  } finally {
    await motor.encerrar?.();
  }
}
