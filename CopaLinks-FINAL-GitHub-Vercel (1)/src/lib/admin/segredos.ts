import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { configuracao, segredos } from "@/db/schema";

/**
 * Cofre de API Keys do CopaLinks — só roda no servidor.
 *
 * Cada valor é cifrado com AES-256-GCM antes de ir para o banco. A chave
 * mestra vem da variável de ambiente SECRETS_MASTER_KEY; se ela não existir,
 * o servidor gera uma e guarda na tabela interna `configuracao` (o painel
 * avisa que o ideal é definir SECRETS_MASTER_KEY fora do banco).
 *
 * Ordem de leitura de cada chave (ex.: COMPOSIO_API_KEY):
 *   1. valor cadastrado pelo administrador no painel (cifrado no banco);
 *   2. variável de ambiente de mesmo nome (process.env.COMPOSIO_API_KEY).
 *
 * Nada aqui devolve o valor para o navegador: as rotas usam só `infoSegredos`,
 * que expõe os 4 últimos caracteres.
 */

export type OrigemSegredo = "painel" | "ambiente" | null;

export type InfoSegredo = {
  chave: string;
  configurado: boolean;
  final4: string | null;
  origem: OrigemSegredo;
  atualizadoEm: string | null;
};

let chaveMestra: { chave: Buffer; origem: "ambiente" | "banco" } | null = null;

async function obterChaveMestra() {
  if (chaveMestra) return chaveMestra;
  const env = process.env.SECRETS_MASTER_KEY;
  if (env && env.length >= 16) {
    // Qualquer texto longo vira 32 bytes via SHA-256.
    chaveMestra = { chave: createHash("sha256").update(env).digest(), origem: "ambiente" };
    return chaveMestra;
  }
  const ler = async () => {
    const [l] = await db
      .select()
      .from(configuracao)
      .where(eq(configuracao.chave, "segredos_chave_mestra"))
      .limit(1);
    return l?.valor ?? null;
  };
  let valor = await ler();
  if (!valor) {
    await db
      .insert(configuracao)
      .values({ chave: "segredos_chave_mestra", valor: randomBytes(32).toString("base64") })
      .onConflictDoNothing();
    valor = await ler();
  }
  chaveMestra = { chave: Buffer.from(valor as string, "base64"), origem: "banco" };
  return chaveMestra;
}

export async function origemChaveMestra() {
  return (await obterChaveMestra()).origem;
}

function cifrar(texto: string, chave: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString("base64");
}

function decifrar(pacote: string, chave: Buffer) {
  const buf = Buffer.from(pacote, "base64");
  const d = createDecipheriv("aes-256-gcm", chave, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

const final4 = (v: string) => v.slice(-4);

/** Valor real de uma chave — uso EXCLUSIVO do servidor (integrações). */
export async function obterSegredo(chave: string): Promise<string | null> {
  const [l] = await db.select().from(segredos).where(eq(segredos.chave, chave)).limit(1);
  if (l) {
    try {
      return decifrar(l.cifrado, (await obterChaveMestra()).chave);
    } catch {
      // Chave mestra trocada: o valor antigo não abre mais. Cai para o .env.
    }
  }
  const env = process.env[chave];
  return env && env.trim() ? env.trim() : null;
}

export async function salvarSegredo(chave: string, valor: string, adminId: number | null) {
  const limpo = valor.trim();
  const cifrado = cifrar(limpo, (await obterChaveMestra()).chave);
  const antes = await db.select({ c: segredos.chave }).from(segredos).where(eq(segredos.chave, chave));
  await db
    .insert(segredos)
    .values({ chave, cifrado, final4: final4(limpo), atualizadoPor: adminId })
    .onConflictDoUpdate({
      target: segredos.chave,
      set: { cifrado, final4: final4(limpo), atualizadoEm: new Date(), atualizadoPor: adminId },
    });
  return { substituiu: antes.length > 0 };
}

export async function removerSegredo(chave: string) {
  const r = await db.delete(segredos).where(eq(segredos.chave, chave)).returning();
  return r.length > 0;
}

/** Só metadados (4 últimos caracteres, origem, data) — seguro para a tela. */
export async function infoSegredos(chaves: string[]): Promise<Record<string, InfoSegredo>> {
  const linhas = chaves.length
    ? await db.select().from(segredos).where(inArray(segredos.chave, chaves))
    : [];
  const out: Record<string, InfoSegredo> = {};
  for (const chave of chaves) {
    const l = linhas.find((x) => x.chave === chave);
    const env = process.env[chave]?.trim();
    out[chave] = l
      ? { chave, configurado: true, final4: l.final4, origem: "painel", atualizadoEm: l.atualizadoEm.toISOString() }
      : env
        ? { chave, configurado: true, final4: final4(env), origem: "ambiente", atualizadoEm: null }
        : { chave, configurado: false, final4: null, origem: null, atualizadoEm: null };
  }
  return out;
}

/** Tira qualquer pedaço de segredo de uma mensagem antes de mostrar/gravar. */
export function semSegredos(texto: string, valores: (string | null | undefined)[]) {
  let t = texto;
  for (const v of valores) if (v && v.length >= 6) t = t.split(v).join("••••");
  return t.slice(0, 300);
}
