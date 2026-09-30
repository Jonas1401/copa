import { NextResponse } from "next/server";
import { db } from "@/db";
import { admins } from "@/db/schema";
import {
  auditar,
  bloqueado,
  conferirCodigoSetup,
  criarSessao,
  descartarCodigoSetup,
  existeAdmin,
  gravarCookie,
  hashSenha,
  ipDe,
  limparFalhas,
  registrarFalha,
} from "@/lib/admin/auth";
import { limparNome } from "@/lib/motoristas";

export const dynamic = "force-dynamic";

/** Cria o PRIMEIRO administrador, com o código de configuração de uso único. */
export async function POST(req: Request) {
  const ip = ipDe(req);
  if (bloqueado(ip)) {
    return NextResponse.json({ erro: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });
  }
  if (await existeAdmin()) {
    return NextResponse.json(
      { erro: "O administrador já foi criado. Entre com usuário e senha." },
      { status: 409 },
    );
  }
  const corpo = await req.json().catch(() => ({}));
  if (!(await conferirCodigoSetup(String(corpo.codigo ?? "")))) {
    registrarFalha(ip);
    return NextResponse.json({ erro: "Código de configuração inválido ou vencido." }, { status: 403 });
  }
  const nome = limparNome(corpo.nome);
  const usuario = String(corpo.usuario ?? "").trim().toLowerCase();
  const senha = String(corpo.senha ?? "");
  if (!nome) return NextResponse.json({ erro: "Digite seu nome." }, { status: 400 });
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    return NextResponse.json(
      { erro: "Usuário: 3 a 30 letras minúsculas, números, ponto ou traço." },
      { status: 400 },
    );
  }
  if (senha.length < 8) {
    return NextResponse.json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const [a] = await db
    .insert(admins)
    .values({ nome, usuario, senhaHash: await hashSenha(senha) })
    .onConflictDoNothing()
    .returning();
  if (!a) return NextResponse.json({ erro: "Esse usuário já existe." }, { status: 409 });

  await descartarCodigoSetup();
  limparFalhas(ip);
  const admin = { id: a.id, nome: a.nome, usuario: a.usuario };
  await auditar({ admin, integracao: "acesso", acao: "criou administrador", ip });
  const token = await criarSessao(a.id);
  return gravarCookie(
    NextResponse.json({ admin, token }, { headers: { "Cache-Control": "no-store" } }),
    token,
  );
}
