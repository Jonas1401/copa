import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { atualizarCategoria, excluirCategoria } from "@/lib/figurinhas-admin";
import { nomeCategoria, ordemFigurinha } from "@/lib/figurinhas-catalogo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ chave: string }> };

/** PATCH /api/admin/figurinhas/categorias/:chave → renomeia ou reordena. */
export async function PATCH(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const { chave } = await params;
  await garantirTabelas();
  const corpo = await req.json().catch(() => ({}));
  const mudancas: { nome?: string; ordem?: number } = {};
  const detalhes: string[] = [];
  if (corpo?.nome !== undefined) {
    const nome = nomeCategoria(String(corpo.nome));
    if (!nome) return NextResponse.json({ erro: "Nome inválido (2 a 40 caracteres)." }, { status: 400 });
    mudancas.nome = nome;
    detalhes.push(`nome "${nome}"`);
  }
  if (corpo?.ordem !== undefined) {
    mudancas.ordem = ordemFigurinha(corpo.ordem);
    detalhes.push(`ordem ${mudancas.ordem}`);
  }
  if (!Object.keys(mudancas).length) return NextResponse.json({ erro: "Nada para atualizar." }, { status: 400 });
  const categoria = await atualizarCategoria(chave, mudancas);
  if (!categoria) return NextResponse.json({ erro: "Categoria não encontrada." }, { status: 404 });
  await auditar({
    admin: g,
    integracao: "figurinhas",
    acao: "atualizou categoria",
    detalhe: `${chave}: ${detalhes.join(", ")}`,
    ip: ipDe(req),
  });
  return NextResponse.json({ categoria });
}

/** DELETE /api/admin/figurinhas/categorias/:chave → remove categorias vazias. */
export async function DELETE(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const { chave } = await params;
  await garantirTabelas();
  const resultado = await excluirCategoria(chave);
  if ("erro" in resultado) {
    const erro = resultado.erro ?? "Não foi possível remover.";
    return NextResponse.json({ erro }, { status: erro.includes("padrão") ? 403 : 409 });
  }
  await auditar({ admin: g, integracao: "figurinhas", acao: "removeu categoria", detalhe: chave, ip: ipDe(req) });
  return NextResponse.json({ categoria: resultado.categoria });
}
