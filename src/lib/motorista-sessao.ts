import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { motoristas, motoristaSessoes } from "@/db/schema";

/** A identidade fica neste aparelho; o ID informado pelo navegador não dá acesso a outros perfis. */
export const COOKIE_MOTORISTA = "copalinks_motorista_sessao";
const DURACAO_SEGUNDOS = 365 * 24 * 60 * 60;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function motoristaDaSessao(): Promise<typeof motoristas.$inferSelect | null> {
  const token = (await cookies()).get(COOKIE_MOTORISTA)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [linha] = await db
    .select({ motorista: motoristas })
    .from(motoristaSessoes)
    .innerJoin(motoristas, eq(motoristas.id, motoristaSessoes.motoristaId))
    .where(and(eq(motoristaSessoes.tokenHash, hash(token)), gt(motoristaSessoes.expiraEm, new Date())))
    .limit(1);
  return linha?.motorista ?? null;
}

/** Cria uma sessão de aparelho; nunca devolve o token no JSON nem o guarda em texto no banco. */
export async function iniciarSessaoMotorista(motoristaId: number, resposta: NextResponse) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(motoristaSessoes).values({
    motoristaId,
    tokenHash: hash(token),
    expiraEm: new Date(Date.now() + DURACAO_SEGUNDOS * 1000),
  });
  resposta.cookies.set(COOKIE_MOTORISTA, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SEGUNDOS,
  });
  return resposta;
}

export const naoAutorizadoMotorista = () =>
  NextResponse.json(
    { erro: "Abra seu perfil neste aparelho para acessar seus pontos." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
