import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { atualizarFigurinha, excluirFigurinha, listarCategorias } from "@/lib/figurinhas-admin";
import { nomeFigurinha, ordemFigurinha } from "@/lib/figurinhas-catalogo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function idValido(params: Promise<{ id: string }>) {
  const { id: valorId } = await params;
  const id = Number(valorId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/admin/figurinhas/:id → renomeia, troca de categoria, reordena ou
 * ativa/desativa. Desativar some do seletor de todo mundo na hora (a mensagem
 * já enviada continua intacta, pois guarda a própria cópia).
 */
export async function PATCH(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const id = await idValido(params);
  if (id === null) return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  await garantirTabelas();

  const corpo = await req.json().catch(() => ({}));
  const mudancas: { nome?: string; categoria?: string; ordem?: number; ativa?: boolean } = {};
  const detalhes: string[] = [];

  if (corpo?.nome !== undefined) {
    const nome = nomeFigurinha(String(corpo.nome));
    if (!nome) return NextResponse.json({ erro: "Nome inválido (2 a 60 caracteres)." }, { status: 400 });
    mudancas.nome = nome;
    detalhes.push(`nome "${nome}"`);
  }
  if (corpo?.categoria !== undefined) {
    const chave = String(corpo.categoria).trim();
    const categorias = await listarCategorias();
    if (!categorias.some((c) => c.chave === chave)) {
      return NextResponse.json({ erro: "Categoria não encontrada." }, { status: 400 });
    }
    mudancas.categoria = chave;
    detalhes.push(`categoria ${chave}`);
  }
  if (corpo?.ordem !== undefined) {
    mudancas.ordem = ordemFigurinha(corpo.ordem);
    detalhes.push(`ordem ${mudancas.ordem}`);
  }
  if (corpo?.ativa !== undefined) {
    mudancas.ativa = Boolean(corpo.ativa);
    detalhes.push(mudancas.ativa ? "ativada" : "desativada");
  }
  if (!Object.keys(mudancas).length) {
    return NextResponse.json({ erro: "Nada para atualizar." }, { status: 400 });
  }

  const figurinha = await atualizarFigurinha(id, mudancas);
  if (!figurinha) return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  await auditar({
    admin: g,
    integracao: "figurinhas",
    acao: "atualizou figurinha",
    detalhe: `#${id} ${figurinha.nome}: ${detalhes.join(", ")}`,
    ip: ipDe(req),
  });
  return NextResponse.json({ figurinha: { ...figurinha, imagemUrl: `/api/figurinhas/${figurinha.id}/imagem` } });
}

/** DELETE /api/admin/figurinhas/:id → exclui do catálogo (as mensagens ficam). */
export async function DELETE(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const id = await idValido(params);
  if (id === null) return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  await garantirTabelas();

  const figurinha = await excluirFigurinha(id);
  if (!figurinha) return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  await auditar({
    admin: g,
    integracao: "figurinhas",
    acao: "excluiu figurinha",
    detalhe: `#${id} ${figurinha.nome} (${figurinha.categoria})`,
    ip: ipDe(req),
  });
  return NextResponse.json({ excluida: figurinha });
}
