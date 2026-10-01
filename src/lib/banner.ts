import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { bannerFontes, bannersMotorista } from "@/db/schema";
import { chamarComposio, composioConfigurado, USUARIO_COMPOSIO } from "@/lib/composio";

/**
 * Imagem do topo da tela inicial, personalizada por motorista (SÓ servidor).
 *
 * Fluxo: foto do motorista → validação → Nano Banana pelo Composio
 * (GEMINI_GENERATE_IMAGE) transforma em foto cinematográfica preservando o
 * caminhão → recorte inteligente 1536×1024 → WebP salvo no banco, só dele.
 * Se o gerador não estiver disponível, aplica um tratamento local (cor,
 * contraste, nitidez e iluminação de cinema) para nunca deixar o motorista
 * sem resposta. Se nem isso der certo, mantém a imagem anterior.
 */

export const LARGURA = 1536;
export const ALTURA = 1024;
export const TAMANHO_MAX_BYTES = 8 * 1024 * 1024;
export const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"] as const;
const MIN_LADO = 320;

export const PROMPT_BANNER = `Transforme esta fotografia de caminhão em uma imagem premium e profissional para ser utilizada como banner principal de um aplicativo de transporte e logística chamado CopaLinks.
Preserve fielmente o caminhão original, incluindo modelo, cabine, carroceria, cores, características visuais e identidade do veículo.
Melhore iluminação, nitidez, contraste, detalhes e qualidade fotográfica.
Crie uma composição cinematográfica profissional, com estrada e ambiente de transporte rodoviário, iluminação dramática de fim de tarde e aparência realista.
Posicione o caminhão do lado DIREITO da composição, em vista três-quartos frontal, deixando o lado esquerdo e a parte de cima visualmente limpos (céu e estrada) para os elementos da interface do aplicativo.
Formato paisagem 3:2.
Aparência de fotografia profissional de publicidade automotiva/logística: alta definição, iluminação cinematográfica, reflexos realistas, profundidade de campo, acabamento premium, detalhes extremamente nítidos e aparência fotográfica realista.
NÃO altere a identidade do caminhão.
NÃO adicione textos, logotipos, placas falsas ou elementos que não existam na imagem original.
NÃO transforme o caminhão em desenho ou ilustração.
Resultado final: fotografia realista, sofisticada e profissional, adequada para o banner principal de um aplicativo moderno.`;

export class ErroBanner extends Error {
  constructor(mensagem: string, public status = 400) {
    super(mensagem);
  }
}

/* ------------------------------------------------------------ validação */
/** Confere tipo, tamanho e se o arquivo é mesmo uma imagem; corrige a rotação do celular. */
export async function prepararFoto(bytes: Buffer, tipo: string): Promise<Buffer> {
  if (!bytes.length) throw new ErroBanner("O envio veio vazio. Tente de novo.");
  if (bytes.length > TAMANHO_MAX_BYTES) throw new ErroBanner("A foto é grande demais (máximo 8 MB).", 413);
  if (!TIPOS_ACEITOS.includes(tipo as (typeof TIPOS_ACEITOS)[number])) {
    throw new ErroBanner("Formato não aceito. Envie uma foto JPG, PNG ou WebP.", 415);
  }
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    throw new ErroBanner("Não consegui abrir essa foto. Ela pode estar incompleta ou corrompida.");
  }
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_LADO) {
    throw new ErroBanner("A foto é pequena demais. Use uma foto com pelo menos 320 px.");
  }
  return sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer();
}

/** Recorte inteligente para o formato do banner, sem deformar. */
export async function paraBanner(img: Buffer): Promise<Buffer> {
  return sharp(img).rotate()
    .resize({ width: LARGURA, height: ALTURA, fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 80 }).toBuffer();
}

/** Reserva sem IA: cores vivas, contraste, nitidez e luz de cinema (céu escuro, centro iluminado). */
export async function tratamentoLocal(foto: Buffer): Promise<Buffer> {
  const base = await sharp(foto).rotate()
    .resize({ width: LARGURA, height: ALTURA, fit: "cover", position: sharp.strategy.attention })
    .modulate({ brightness: 1.03, saturation: 1.22 })
    .linear(1.12, -10)
    .sharpen({ sigma: 1.1 })
    .toBuffer();
  const luz = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA}" height="${ALTURA}">
    <defs>
      <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#06173a" stop-opacity="0.55"/>
        <stop offset="0.45" stop-color="#06173a" stop-opacity="0"/>
        <stop offset="1" stop-color="#020812" stop-opacity="0.35"/>
      </linearGradient>
      <linearGradient id="lado" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#030c20" stop-opacity="0.5"/>
        <stop offset="0.5" stop-color="#030c20" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="sol" cx="0.78" cy="0.55" r="0.55">
        <stop offset="0" stop-color="#ffb347" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#ceu)"/>
    <rect width="100%" height="100%" fill="url(#lado)"/>
    <rect width="100%" height="100%" fill="url(#sol)"/>
  </svg>`);
  return sharp(base).composite([{ input: luz, blend: "over" }]).webp({ quality: 80 }).toBuffer();
}

/* ------------------------------------------------------- gerador (Composio) */
type Esquema = { properties?: Record<string, { type?: string; description?: string; items?: { type?: string } }>; required?: string[] };

/** Endereço público do app (o gerador precisa conseguir baixar a foto). */
function enderecoPublico() {
  const site = process.env.SITE_URL?.trim().replace(/\/$/, "");
  if (site?.startsWith("https://")) return site;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return prod ? `https://${prod}` : null;
}

/** Procura a imagem gerada em qualquer formato que o Composio devolver. */
export async function extrairImagem(dado: unknown): Promise<Buffer | null> {
  const textos: string[] = [];
  const andar = (v: unknown, prof = 0) => {
    if (prof > 8 || v == null) return;
    if (typeof v === "string") textos.push(v);
    else if (Array.isArray(v)) v.forEach((x) => andar(x, prof + 1));
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => andar(x, prof + 1));
  };
  andar(dado);
  for (const t of textos) {
    const m = t.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
    if (m) return Buffer.from(m[1], "base64");
  }
  for (const t of textos) {
    if (/^https?:\/\/\S+$/i.test(t) && !/composio\.dev\/(docs|api)/.test(t)) {
      try {
        const r = await fetch(t, { signal: AbortSignal.timeout(20000) });
        const tipo = r.headers.get("content-type") ?? "";
        if (r.ok && (tipo.startsWith("image/") || tipo.includes("octet-stream"))) return Buffer.from(await r.arrayBuffer());
      } catch {
        /* tenta o próximo */
      }
    }
  }
  for (const t of textos) {
    if (t.length > 20_000 && /^[A-Za-z0-9+/=\s]+$/.test(t)) return Buffer.from(t.replace(/\s+/g, ""), "base64");
  }
  return null;
}

/** Monta os argumentos conforme os campos que a ferramenta declara (lidos na hora). */
export function montarArgumentos(esquema: Esquema | null, foto: { url: string | null; base64: string }) {
  const props = esquema?.properties ?? {};
  const nomes = Object.keys(props);
  const args: Record<string, unknown> = {};
  const campoPrompt = nomes.find((n) => /^(prompt|text|instruction)s?$/i.test(n)) ?? "prompt";
  args[campoPrompt] = PROMPT_BANNER;
  if (nomes.includes("aspect_ratio")) args.aspect_ratio = "3:2";
  const campoImg = nomes.find((n) => /image|imagem|reference|input_file|source/i.test(n) && !/aspect|size|count|number|format|output/i.test(n));
  if (!campoImg) return { args, campoImg: null as string | null };
  const def = props[campoImg] ?? {};
  const desc = `${campoImg} ${def.description ?? ""}`.toLowerCase();
  const querLista = def.type === "array";
  const querBase64 = /base64|data\b|bytes|inline/.test(desc) && !/url/.test(desc);
  const valor = querBase64 || !foto.url ? `data:image/jpeg;base64,${foto.base64}` : foto.url;
  args[campoImg] = querLista ? [valor] : valor;
  return { args, campoImg };
}

async function gerarComComposio(foto: Buffer): Promise<Buffer | null> {
  if (!(await composioConfigurado())) return null;
  let esquema: Esquema | null = null;
  try {
    const t = await chamarComposio<{ input_parameters?: Esquema; inputParameters?: Esquema }>("/tools/GEMINI_GENERATE_IMAGE");
    esquema = t.input_parameters ?? t.inputParameters ?? null;
  } catch {
    esquema = null;
  }
  // Foto disponível por 10 min num endereço secreto para o gerador baixar.
  const token = randomBytes(24).toString("base64url");
  const base = enderecoPublico();
  await db.delete(bannerFontes).where(lt(bannerFontes.expiraEm, new Date()));
  await db.insert(bannerFontes).values({ token, imagem: foto.toString("base64"), expiraEm: new Date(Date.now() + 10 * 60_000) });
  try {
    const { args, campoImg } = montarArgumentos(esquema, {
      url: base ? `${base}/api/banner-fonte/${token}` : null,
      base64: foto.toString("base64"),
    });
    if (!campoImg) return null; // ferramenta não aceita foto de entrada: não inventa caminhão
    const r = await chamarComposio<{ data?: unknown; successful?: boolean; error?: string | null }>(
      "/tools/execute/GEMINI_GENERATE_IMAGE",
      { method: "POST", signal: AbortSignal.timeout(50_000), body: JSON.stringify({ user_id: USUARIO_COMPOSIO, arguments: args }) },
    );
    if (r.successful === false) return null;
    const img = await extrairImagem(r.data);
    if (!img) return null;
    await sharp(img).metadata(); // garante que é imagem de verdade
    return img;
  } catch {
    return null;
  } finally {
    await db.delete(bannerFontes).where(eq(bannerFontes.token, token)).catch(() => {});
  }
}

/* ------------------------------------------------------------- operações */
export async function processarBanner(motoristaId: number, bytes: Buffer, tipo: string) {
  const foto = await prepararFoto(bytes, tipo);
  let via: "ia" | "local" = "ia";
  let final: Buffer | null = null;
  const gerada = await gerarComComposio(foto).catch(() => null);
  if (gerada) final = await paraBanner(gerada).catch(() => null);
  if (!final) {
    via = "local";
    final = await tratamentoLocal(foto).catch(() => null);
  }
  if (!final) throw new ErroBanner("Não foi possível processar a imagem. Tente novamente.", 502);
  const versao = randomBytes(6).toString("hex");
  await db.insert(bannersMotorista)
    .values({ motoristaId, imagem: final.toString("base64"), via, versao, atualizadoEm: new Date() })
    .onConflictDoUpdate({
      target: bannersMotorista.motoristaId,
      set: { imagem: final.toString("base64"), via, versao, atualizadoEm: new Date() },
    });
  return { versao, via };
}

export async function infoBanner(motoristaId: number) {
  const [b] = await db.select({ versao: bannersMotorista.versao, via: bannersMotorista.via })
    .from(bannersMotorista).where(eq(bannersMotorista.motoristaId, motoristaId)).limit(1);
  return b ?? null;
}

export async function imagemBanner(motoristaId: number) {
  const [b] = await db.select({ imagem: bannersMotorista.imagem }).from(bannersMotorista)
    .where(eq(bannersMotorista.motoristaId, motoristaId)).limit(1);
  return b ? Buffer.from(b.imagem, "base64") : null;
}

export async function removerBanner(motoristaId: number) {
  await db.delete(bannersMotorista).where(eq(bannersMotorista.motoristaId, motoristaId));
}

export async function fonteTemporaria(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const [f] = await db.select().from(bannerFontes).where(eq(bannerFontes.token, token)).limit(1);
  if (!f || f.expiraEm < new Date()) return null;
  return Buffer.from(f.imagem, "base64");
}
