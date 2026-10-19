import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { criarCategoria, listarCategorias } from "@/lib/figurinhas-admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/figurinhas/categorias → categorias em ordem de exibição. */
export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  return NextResponse.json({ categorias: await listarCategorias() }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/admin/figurinhas/categorias → categoria nova (pacote futuro).
 * Corpo: { nome, ordem?, pacote? }. O chat e o seletor passam a mostrá-la
 * automaticamente, sem alterar código.
 */
export async function POST(req: Request) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  const corpo = await req.json().catch(() => ({}));
  const resultado = await criarCategoria({
    nome: String(corpo?.nome ?? ""),
    chave: corpo?.chave ? String(corpo.chave) : undefined,
    ordem: corpo?.ordem,
    pacote: corpo?.pacote ? String(corpo.pacote) : undefined,
  });
  if ("erro" in resultado) return NextResponse.json({ erro: resultado.erro }, { status: 400 });
  await auditar({
    admin: g,
    integracao: "figurinhas",
    acao: "criou categoria",
    detalhe: `${resultado.categoria.nome} (${resultado.categoria.chave})`,
    ip: ipDe(req),
  });
  return NextResponse.json({ categoria: resultado.categoria }, { status: 201 });
}
