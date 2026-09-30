import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSessoes, admins } from "@/db/schema";
import {
  auditar,
  bloqueado,
  conferirCodigoSetup,
  descartarCodigoSetup,
  hashSenha,
  ipDe,
  limparFalhas,
  registrarFalha,
} from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";

export const dynamic = "force-dynamic";

/**
 * Redefine a senha de um administrador com o código de configuração.
 *
 * O código é o mesmo do primeiro cadastro (ADMIN_SETUP_CODE no ambiente ou
 * hash guardado em `configuracao`), e é de USO ÚNICO: depois de usado, é
 * descartado. Tentativas limitadas por IP, como no login.
 *
 * Corpo: { codigo, novaSenha, usuario? }. Se houver um único administrador,
 * o `usuario` pode ser omitido.
 */
export async function POST(req: Request) {
  await garantirTabelas().catch(() => {});
  const semCache = { "Cache-Control": "no-store" };
  const ip = ipDe(req);
  if (bloqueado(ip)) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde 15 minutos." },
      { status: 429, headers: semCache },
    );
  }

  const corpo = await req.json().catch(() => ({}));
  if (!(await conferirCodigoSetup(String(corpo.codigo ?? "")))) {
    registrarFalha(ip);
    return NextResponse.json(
      { erro: "Código de configuração inválido." },
      { status: 403, headers: semCache },
    );
  }

  const novaSenha = String(corpo.novaSenha ?? "");
  if (novaSenha.length < 8) {
    return NextResponse.json(
      { erro: "A nova senha precisa ter pelo menos 8 caracteres." },
      { status: 400, headers: semCache },
    );
  }

  const usuario = String(corpo.usuario ?? "").trim().toLowerCase();
  const todos = await db
    .select({ id: admins.id, nome: admins.nome, usuario: admins.usuario })
    .from(admins);
  if (!todos.length) {
    return NextResponse.json(
      { erro: "Nenhum administrador cadastrado. Use a tela de primeiro acesso." },
      { status: 404, headers: semCache },
    );
  }
  const alvo = usuario
    ? todos.find((a) => a.usuario === usuario)
    : todos.length === 1
      ? todos[0]
      : undefined;
  if (!alvo) {
    return NextResponse.json(
      { erro: "Informe o usuário do administrador." },
      { status: 400, headers: semCache },
    );
  }

  await db
    .update(admins)
    .set({ senhaHash: await hashSenha(novaSenha) })
    .where(eq(admins.id, alvo.id));
  // Sessões antigas perdem a validade: quem tinha acesso precisa entrar de novo.
  await db.delete(adminSessoes).where(eq(adminSessoes.adminId, alvo.id));
  await descartarCodigoSetup();
  limparFalhas(ip);
  await auditar({
    admin: alvo,
    integracao: "acesso",
    acao: "redefiniu senha com código",
    ip,
  });
  return NextResponse.json({ ok: true, usuario: alvo.usuario }, { headers: semCache });
}
