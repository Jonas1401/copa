import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import {
  criarFigurinha,
  garantirFigurinhasPadrao,
  listarCategorias,
  listarFigurinhas,
} from "@/lib/figurinhas-admin";
import {
  formatoFigurinha,
  nomeFigurinha,
  TAMANHO_MAX_FIGURINHA,
} from "@/lib/figurinhas-catalogo";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/figurinhas → catálogo completo (ativas e desativadas) com as
 * categorias, para o painel de administração.
 */
export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirFigurinhasPadrao();
  const [categorias, figurinhas] = await Promise.all([listarCategorias(), listarFigurinhas()]);
  return NextResponse.json(
    {
      categorias: categorias.map((c) => ({ chave: c.chave, nome: c.nome, ordem: c.ordem, pacote: c.pacote })),
      figurinhas: figurinhas.map((f) => ({
        id: f.id,
        nome: f.nome,
        categoria: f.categoria,
        mime: f.mime,
        ativa: f.ativa,
        ordem: f.ordem,
        pacote: f.pacote,
        imagemUrl: `/api/figurinhas/${f.id}/imagem`,
        animada: f.mime === "image/gif",
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * POST /api/admin/figurinhas → publica uma figurinha nova.
 * Corpo JSON: { nome, categoria, arquivoBase64, mime?, ordem?, ativa? }.
 *
 * Valida tamanho (até 512 KB) e formato pelos bytes reais do arquivo — o MIME
 * que o navegador informa não basta. Só administradores logados publicam.
 */
export async function POST(req: Request) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  await garantirTabelas();
  await garantirFigurinhasPadrao();

  const tamanhoPedido = Number(req.headers.get("content-length"));
  const tetoPedido = Math.ceil((TAMANHO_MAX_FIGURINHA * 4) / 3) + 256 * 1024;
  if (Number.isFinite(tamanhoPedido) && tamanhoPedido > tetoPedido) {
    return NextResponse.json({ erro: "A imagem precisa ter até 512 KB." }, { status: 413 });
  }
  const corpo = await req.json().catch(() => ({}));

  const nome = nomeFigurinha(String(corpo?.nome ?? ""));
  const categoria = String(corpo?.categoria ?? "").trim();
  const arquivoBase64 = String(corpo?.arquivoBase64 ?? "").trim();
  if (!nome) return NextResponse.json({ erro: "Informe um nome de 2 a 60 caracteres." }, { status: 400 });
  if (!categoria) return NextResponse.json({ erro: "Escolha a categoria da figurinha." }, { status: 400 });
  if (!arquivoBase64) return NextResponse.json({ erro: "Escolha uma imagem PNG, WebP ou GIF." }, { status: 400 });
  if (arquivoBase64.length > Math.ceil((TAMANHO_MAX_FIGURINHA * 4) / 3) + 64) {
    return NextResponse.json({ erro: "A imagem precisa ter até 512 KB." }, { status: 413 });
  }

  const bytes = Buffer.from(arquivoBase64, "base64");
  const formato = formatoFigurinha(new Uint8Array(bytes), String(corpo?.mime ?? ""));
  if (!formato) {
    return NextResponse.json({ erro: "Formato não compatível. Envie PNG, WebP ou GIF." }, { status: 415 });
  }

  const categorias = await listarCategorias();
  if (!categorias.some((c) => c.chave === categoria)) {
    return NextResponse.json({ erro: "Categoria não encontrada." }, { status: 400 });
  }

  const figurinha = await criarFigurinha({
    nome,
    categoria,
    mime: formato.mime,
    dados: bytes.toString("base64"),
    ordem: Number(corpo?.ordem),
    ativa: corpo?.ativa === undefined ? true : Boolean(corpo.ativa),
  });
  await auditar({
    admin: g,
    integracao: "figurinhas",
    acao: "publicou figurinha",
    detalhe: `${nome} (${categoria}, ${formato.extensao})`,
    ip: ipDe(req),
  });
  return NextResponse.json(
    { figurinha: { ...figurinha, imagemUrl: `/api/figurinhas/${figurinha.id}/imagem` } },
    { status: 201 },
  );
}
