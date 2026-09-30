import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { definicao, limparStatus, listarEstados, testar } from "@/lib/admin/integracoes";
import { removerSegredo, salvarSegredo } from "@/lib/admin/segredos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Salvar / substituir configuração. Corpo: { valores: { CHAVE: "valor" } }.
 * Campos vazios são ignorados (não apagam o que já existe).
 * A resposta traz só o status — nunca o valor salvo.
 */
export async function PUT(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const { id } = await params;
  const d = definicao(id);
  if (!d || !d.podeSalvar) return NextResponse.json({ erro: "Integração sem campos editáveis." }, { status: 400 });

  const corpo = await req.json().catch(() => ({}));
  const valores = (corpo?.valores ?? {}) as Record<string, unknown>;
  const alterados: string[] = [];
  for (const campo of d.campos) {
    const bruto = valores[campo.chave];
    if (typeof bruto !== "string" || !bruto.trim()) continue;
    const v = bruto.trim();
    if (v.length > 4000) return NextResponse.json({ erro: `${campo.rotulo}: valor grande demais.` }, { status: 400 });
    if (campo.opcoes && !campo.opcoes.some((o) => o.valor === v)) {
      return NextResponse.json({ erro: `${campo.rotulo}: opção inválida.` }, { status: 400 });
    }
    if (campo.secreto && v.length < 6) {
      return NextResponse.json({ erro: `${campo.rotulo}: valor curto demais.` }, { status: 400 });
    }
    const { substituiu } = await salvarSegredo(campo.chave, v, g.id);
    alterados.push(`${campo.chave} (${substituiu ? "substituída" : "cadastrada"})`);
  }
  if (!alterados.length) return NextResponse.json({ erro: "Preencha pelo menos um campo." }, { status: 400 });

  await limparStatus(d.id);
  // Só o NOME das variáveis vai para a auditoria — nunca o valor.
  await auditar({ admin: g, integracao: d.id, acao: "salvou configuração", detalhe: alterados.join(", "), ip: ipDe(req) });
  // Testa na hora para o painel já mostrar Conectado/Erro.
  const teste = await testar(d.id);
  await auditar({ admin: g, integracao: d.id, acao: "testou conexão", detalhe: teste.status, ip: ipDe(req) });
  return NextResponse.json({ integracoes: await listarEstados(), teste });
}

/** Remove as chaves da integração (pede confirmação na tela). */
export async function DELETE(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const { id } = await params;
  const d = definicao(id);
  if (!d || !d.podeRemover) return NextResponse.json({ erro: "Esta integração não tem chaves para remover." }, { status: 400 });

  const removidas: string[] = [];
  for (const campo of d.campos) if (await removerSegredo(campo.chave)) removidas.push(campo.chave);
  await limparStatus(d.id);
  await auditar({
    admin: g,
    integracao: d.id,
    acao: "removeu chave",
    detalhe: removidas.length ? removidas.join(", ") : "nada salvo no painel",
    ip: ipDe(req),
  });
  return NextResponse.json({ integracoes: await listarEstados() });
}
