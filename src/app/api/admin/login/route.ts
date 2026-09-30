import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admins } from "@/db/schema";
import {
  auditar,
  bloqueado,
  conferirSenha,
  criarSessao,
  garantirAdminDefault,
  gravarCookie,
  ipDe,
  limparFalhas,
  registrarFalha,
} from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await garantirTabelas();
  await garantirAdminDefault();
  const ip = ipDe(req);
  if (bloqueado(ip)) {
    return NextResponse.json({ erro: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });
  }
  const corpo = await req.json().catch(() => ({}));
  const usuario = String(corpo.usuario ?? "").trim().toLowerCase();
  const senha = String(corpo.senha ?? "");
  const [a] = usuario
    ? await db.select().from(admins).where(eq(admins.usuario, usuario)).limit(1)
    : [];
  // Mesma resposta para usuário inexistente e senha errada.
  if (!a || !(await conferirSenha(senha, a.senhaHash))) {
    registrarFalha(ip);
    await auditar({
      admin: a ? { id: a.id, nome: a.nome, usuario: a.usuario } : null,
      integracao: "acesso",
      acao: "login recusado",
      detalhe: a ? "" : "usuário inexistente",
      ip,
    });
    return NextResponse.json({ erro: "Usuário ou senha incorretos." }, { status: 401 });
  }
  limparFalhas(ip);
  const admin = { id: a.id, nome: a.nome, usuario: a.usuario };
  await auditar({ admin, integracao: "acesso", acao: "entrou", ip });
  const token = await criarSessao(a.id);
  return gravarCookie(
    NextResponse.json({ admin, token }, { headers: { "Cache-Control": "no-store" } }),
    token,
  );
}
