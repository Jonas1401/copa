import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/supabase";
import { monitorDevices, monitorPairCodes } from "@/db/schema";

export type TipoAparelho = "MONITOR" | "RECEIVER";
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALIDADE_MINUTOS = 10;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function codigoLimpo(v: unknown) {
  return typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export async function gerarPareamento(tipo: TipoAparelho, motoristaId: number | null) {
  await db.delete(monitorPairCodes).where(lt(monitorPairCodes.expiraEm, sql`now() - interval '1 day'`));
  // 12 caracteres (~60 bits de entropia), legíveis, sem 0/O ou 1/I.
  const codigo = Array.from({ length: 12 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");
  const expiraEm = new Date(Date.now() + VALIDADE_MINUTOS * 60_000);
  await db.insert(monitorPairCodes).values({ tipo, motoristaId, codigoHash: sha256(codigo), expiraEm });
  return { codigo: `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8)}`, expiraEm: expiraEm.toISOString() };
}

export function fcmTokenValido(v: unknown): v is string {
  return typeof v === "string" && v.length >= 30 && v.length <= 4096 && /^[A-Za-z0-9_:\-\.]+$/.test(v);
}

/** Consome o código em transação e devolve a credencial UMA vez ao aparelho. */
export async function parearAparelho(
  tipo: TipoAparelho,
  codigoRecebido: unknown,
  nomeRecebido: unknown,
  fcmToken: unknown,
) {
  const codigo = codigoLimpo(codigoRecebido);
  if (codigo.length !== 12 || [...codigo].some((c) => !ALFABETO.includes(c))) return null;
  if (tipo === "RECEIVER" && !fcmTokenValido(fcmToken)) return null;
  const nome = typeof nomeRecebido === "string" ? nomeRecebido.trim().slice(0, 80) : "Android CopaLinks";
  const segredo = randomBytes(32).toString("base64url");
  const resultado = await db.transaction(async (tx) => {
    const [par] = await tx.update(monitorPairCodes)
      .set({ usadoEm: new Date() })
      .where(and(
        eq(monitorPairCodes.codigoHash, sha256(codigo)), eq(monitorPairCodes.tipo, tipo),
        isNull(monitorPairCodes.usadoEm), gt(monitorPairCodes.expiraEm, new Date()),
      )).returning();
    if (!par || (tipo === "RECEIVER" && !par.motoristaId)) return null;
    const [device] = await tx.insert(monitorDevices).values({
      tipo, motoristaId: tipo === "RECEIVER" ? par.motoristaId : null,
      tokenHash: sha256(segredo), fcmToken: tipo === "RECEIVER" ? String(fcmToken) : null,
      nome: nome || "Android CopaLinks", ultimoContatoEm: new Date(),
    }).returning({ id: monitorDevices.id });
    return device;
  });
  return resultado ? { deviceId: resultado.id, deviceSecret: segredo, tipo } : null;
}

/** O segredo só vem no Authorization do Android, nunca em URL, cookie ou query. */
export async function dispositivoAutenticado(req: Request, tipo?: TipoAparelho) {
  const auth = req.headers.get("authorization") ?? "";
  const segredo = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth)?.[1];
  if (!segredo) return null;
  const [device] = await db.select().from(monitorDevices)
    .where(and(eq(monitorDevices.tokenHash, sha256(segredo)), eq(monitorDevices.ativo, 1)))
    .limit(1);
  if (!device || (tipo && device.tipo !== tipo)) return null;
  return device;
}

export async function marcarAtivo(deviceId: number) {
  await db.update(monitorDevices).set({ ultimoContatoEm: new Date() }).where(eq(monitorDevices.id, deviceId));
}

/** Apenas contagem agregada; usada no painel, não expõe os códigos de ativação. */
export async function pareamentosAtivos(tipo: TipoAparelho) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(monitorPairCodes)
    .where(and(eq(monitorPairCodes.tipo, tipo), isNull(monitorPairCodes.usadoEm), gt(monitorPairCodes.expiraEm, new Date())));
  return r?.n ?? 0;
}
