import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gt, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSessoes, admins, auditoria, configuracao } from "@/db/schema";

/**
 * Controle de acesso da área administrativa.
 *   - Senha: scrypt com sal aleatório.
 *   - Sessão: token aleatório em cookie httpOnly + SameSite=Strict; no banco
 *     fica só o SHA-256 do token. Validade de 12 horas.
 *   - O mesmo token também vale no header "Authorization: Bearer ...". Isso
 *     mantém a sessão quando o navegador bloqueia o cookie (app aberto dentro
 *     de outra página, como a janela de pré-visualização, ou em WebViews).
 *     Header não é enviado por formulários de outros sites (sem risco de CSRF).
 *   - Primeiro administrador: criado com um código de configuração de uso
 *     único (ADMIN_SETUP_CODE no ambiente, ou gerado pelo servidor).
 *   - Tentativas de login limitadas por IP.
 */

const scrypt = promisify(scryptCb) as (s: string, salt: Buffer, n: number) => Promise<Buffer>;

export const COOKIE_ADMIN = "copalinks_admin";
const VALIDADE_MS = 12 * 60 * 60 * 1000;

export type AdminLogado = { id: number; nome: string; usuario: string };

/* --------------------------------------------------------------- senhas */
export async function hashSenha(senha: string) {
  const sal = randomBytes(16);
  const h = await scrypt(senha, sal, 64);
  return `${sal.toString("hex")}:${h.toString("hex")}`;
}

export async function conferirSenha(senha: string, guardado: string) {
  const [salHex, hHex] = guardado.split(":");
  if (!salHex || !hHex) return false;
  const h = await scrypt(senha, Buffer.from(salHex, "hex"), 64);
  const esperado = Buffer.from(hHex, "hex");
  return esperado.length === h.length && timingSafeEqual(esperado, h);
}

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/* -------------------------------------------------------------- sessões */
export async function criarSessao(adminId: number) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(adminSessoes).values({
    adminId,
    tokenHash: sha256(token),
    expiraEm: new Date(Date.now() + VALIDADE_MS),
  });
  await db.update(admins).set({ ultimoAcessoEm: new Date() }).where(eq(admins.id, adminId));
  await db.delete(adminSessoes).where(lt(adminSessoes.expiraEm, new Date()));
  return token;
}

export function gravarCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_ADMIN, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VALIDADE_MS / 1000,
  });
  return res;
}

export function apagarCookie(res: NextResponse) {
  res.cookies.set(COOKIE_ADMIN, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

/** Token da sessão: cookie httpOnly ou, se o navegador bloquear, o header. */
async function tokenDaRequisicao() {
  const doCookie = (await cookies()).get(COOKIE_ADMIN)?.value;
  if (doCookie) return doCookie;
  const auth = (await headers()).get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return m ? m[1] : null;
}

export async function adminAtual(): Promise<AdminLogado | null> {
  const token = await tokenDaRequisicao();
  if (!token) return null;
  const [linha] = await db
    .select({ id: admins.id, nome: admins.nome, usuario: admins.usuario })
    .from(adminSessoes)
    .innerJoin(admins, eq(admins.id, adminSessoes.adminId))
    .where(and(eq(adminSessoes.tokenHash, sha256(token)), gt(adminSessoes.expiraEm, new Date())))
    .limit(1);
  return linha ?? null;
}

export async function encerrarSessao() {
  const token = await tokenDaRequisicao();
  if (token) await db.delete(adminSessoes).where(eq(adminSessoes.tokenHash, sha256(token)));
}

/**
 * Porteiro das rotas de admin. Uso:
 *   const g = await exigirAdmin(); if (g instanceof NextResponse) return g;
 */
export async function exigirAdmin(): Promise<AdminLogado | NextResponse> {
  const a = await adminAtual();
  if (!a) {
    return NextResponse.json(
      { erro: "Acesso restrito ao administrador." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return a;
}

/* ------------------------------------------------- primeiro administrador */
export async function existeAdmin() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(admins);
  return (n ?? 0) > 0;
}

/** Garante um administrador inicial somente quando ADMIN_PASSWORD foi configurada. */
export async function garantirAdminDefault() {
  try {
    const [a] = await db.select().from(admins).where(eq(admins.usuario, "admin")).limit(1);
    if (!a) {
      const senha = process.env.ADMIN_PASSWORD?.trim();
      if (!senha || senha.length < 8) return;
      const senhaHash = await hashSenha(senha);
      await db
        .insert(admins)
        .values({
          nome: "Administrador CopaLinks",
          usuario: "admin",
          senhaHash,
        })
        .onConflictDoNothing();
    }
  } catch {
    // se ainda não criou a tabela ou der erro transitório, ignora
  }
}

/**
 * Códigos de configuração gerados para o dono do app (só o hash fica no
 * banco). Valem 48 h e são de uso único: usar QUALQUER um descarta todos.
 * Chave principal "admin_setup_codigo_hash" + extras "admin_setup_codigo_hash:<id>",
 * para dois códigos emitidos em paralelo não se invalidarem.
 */
const CHAVE_CODIGO_SETUP = "admin_setup_codigo_hash";
const VALIDADE_CODIGO_SETUP_MS = 48 * 60 * 60 * 1000;

/** Ignora espaços, traços e maiúsculas: "copa-7k4m 9rtb" = "COPA7K4M9RTB". */
export const normalizarCodigoSetup = (codigo: string) =>
  codigo.toUpperCase().replace(/[^A-Z0-9]/g, "");

const filtroCodigosSetup = () =>
  or(eq(configuracao.chave, CHAVE_CODIGO_SETUP), like(configuracao.chave, `${CHAVE_CODIGO_SETUP}:%`));

const mesmoHash = (guardado: string, hash: string) => {
  const a = Buffer.from(guardado);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Confere o código de configuração (de uso único) do administrador. */
export async function conferirCodigoSetup(codigo: string) {
  const limpo = normalizarCodigoSetup(codigo);
  if (limpo.length < 8) return false;
  // Formato novo (sem traços/espaços) e o antigo (só maiúsculas), para códigos
  // já emitidos continuarem valendo.
  const hashes = [sha256(limpo), sha256(codigo.trim().toUpperCase())];
  const env = normalizarCodigoSetup(process.env.ADMIN_SETUP_CODE ?? "");
  if (env.length >= 8 && mesmoHash(sha256(env), hashes[0])) return true;
  const linhas = await db.select().from(configuracao).where(filtroCodigosSetup());
  const agora = Date.now();
  return linhas.some(
    (l) =>
      agora - l.criadoEm.getTime() <= VALIDADE_CODIGO_SETUP_MS && hashes.some((h) => mesmoHash(l.valor, h)),
  );
}

export async function descartarCodigoSetup() {
  await db.delete(configuracao).where(filtroCodigosSetup());
}

/* ------------------------------------------------------ limite de tentativas */
const tentativas = new Map<string, { n: number; desde: number }>();
const JANELA = 15 * 60 * 1000;
const MAXIMO = 6;

export function ipDe(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function bloqueado(ip: string) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > JANELA) return false;
  return t.n >= MAXIMO;
}

export function registrarFalha(ip: string) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > JANELA) tentativas.set(ip, { n: 1, desde: Date.now() });
  else t.n += 1;
}

export function limparFalhas(ip: string) {
  tentativas.delete(ip);
}

/* -------------------------------------------------------------- auditoria */
export async function auditar(entrada: {
  admin: AdminLogado | null;
  integracao: string;
  acao: string;
  detalhe?: string;
  ip?: string;
}) {
  await db.insert(auditoria).values({
    adminId: entrada.admin?.id ?? null,
    adminNome: entrada.admin?.nome ?? "desconhecido",
    integracao: entrada.integracao,
    acao: entrada.acao,
    detalhe: (entrada.detalhe ?? "").slice(0, 300),
    ip: (entrada.ip ?? "").slice(0, 60),
  });
}
