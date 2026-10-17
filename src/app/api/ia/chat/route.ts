import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { iaMensagens } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import { ErroIA, perguntarIA } from "@/lib/ia";
import { ErroImagem, analisarImagemIA, gerarImagemIA, imagemDeDataUrl, podeGerarImagem, querGerarImagem } from "@/lib/ia-imagem";
import { garantirColunaImagem } from "@/lib/ia-imagem-banco";

export const dynamic = "force-dynamic";
// Criar uma imagem pode levar bem mais que uma resposta de texto.
export const maxDuration = 60;

const PERGUNTA_MAX = 1000;
const HISTORICO_CTX = 10; // últimas trocas enviadas à IA como contexto
const HISTORICO_TELA = 40; // mensagens devolvidas para a tela
const RESPOSTA_IMAGEM_CRIADA = "Pronto! Aqui está a imagem. 🖼️";
const RESPOSTA_IMAGEM_EDITADA = "Pronto! Fiz a imagem a partir da sua foto. 🖼️";

// Freio: até 10 perguntas por minuto e 60 por hora por motorista.
const janelas = new Map<number, number[]>();
function podePerguntar(id: number) {
  const agora = Date.now();
  const lista = (janelas.get(id) ?? []).filter((t) => agora - t < 3600_000);
  const noMinuto = lista.filter((t) => agora - t < 60_000).length;
  if (noMinuto >= 10 || lista.length >= 60) return false;
  lista.push(agora);
  janelas.set(id, lista);
  return true;
}

const semCache = { "Cache-Control": "no-store" };

async function motoristaOuErro(idBruto: unknown) {
  const m = await motoristaDaSessao();
  return m && Number(idBruto) === m.id ? m : null;
}

/** GET /api/ia/chat?motoristaId=1 → conversa deste motorista. */
export async function GET(req: Request) {
  await garantirTabelas();
  await garantirColunaImagem();
  const url = new URL(req.url);
  const m = await motoristaOuErro(url.searchParams.get("motoristaId"));
  if (!m) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para falar com o assistente." }, { status: 403, headers: semCache });
  }
  const linhas = await db
    .select({
      id: iaMensagens.id,
      papel: iaMensagens.papel,
      texto: iaMensagens.texto,
      criadoEm: iaMensagens.criadoEm,
      temImagem: sql<boolean>`${iaMensagens.imagemDados} is not null`,
    })
    .from(iaMensagens)
    .where(eq(iaMensagens.motoristaId, m.id))
    .orderBy(desc(iaMensagens.id))
    .limit(HISTORICO_TELA);
  const mensagens = linhas.reverse().map((l) => ({
    id: l.id,
    papel: l.papel,
    texto: l.texto,
    criadoEm: l.criadoEm.toISOString(),
    temImagem: Boolean(l.temImagem),
  }));
  return NextResponse.json({ mensagens }, { headers: semCache });
}

/**
 * POST /api/ia/chat { motoristaId, texto, imagem? } → pergunta e recebe a resposta.
 * - `imagem` (data URL de foto) + pergunta → a IA analisa a foto (visão).
 * - pedido de imagem ("gera uma imagem de…") → cria a imagem (Composio ou API direta).
 * - sem foto e sem pedido de imagem → conversa de sempre, sem mudança.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  await garantirColunaImagem();
  const corpo = await req.json().catch(() => ({}));
  const m = await motoristaOuErro(corpo?.motoristaId);
  if (!m) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para falar com o assistente." }, { status: 403, headers: semCache });
  }
  const texto = String(corpo?.texto ?? "").trim().slice(0, PERGUNTA_MAX);
  const dataUrl = typeof corpo?.imagem === "string" ? corpo.imagem : "";
  if (!texto && !dataUrl) {
    return NextResponse.json({ erro: "Escreva sua pergunta ou envie uma foto." }, { status: 400, headers: semCache });
  }
  let foto: Buffer | null = null;
  if (dataUrl) {
    try {
      foto = await imagemDeDataUrl(dataUrl);
    } catch (e) {
      const status = e instanceof ErroImagem ? e.status : 400;
      const erro = e instanceof ErroImagem ? e.message : "Não consegui abrir essa foto. Tente outra.";
      return NextResponse.json({ erro }, { status, headers: semCache });
    }
  }
  const criarImagem = querGerarImagem(texto);
  if (!podePerguntar(m.id)) {
    return NextResponse.json({ erro: "Muitas perguntas seguidas. Aguarde um pouco." }, { status: 429, headers: semCache });
  }
  if (criarImagem && !podeGerarImagem(m.id)) {
    return NextResponse.json({ erro: "Você já pediu muitas imagens nesta hora. Aguarde um pouco." }, { status: 429, headers: semCache });
  }

  const anteriores = await db
    .select()
    .from(iaMensagens)
    .where(eq(iaMensagens.motoristaId, m.id))
    .orderBy(desc(iaMensagens.id))
    .limit(HISTORICO_CTX * 2);
  const historico = anteriores
    .reverse()
    .filter((l) => l.papel === "user" || l.papel === "assistant")
    .map((l) => ({ papel: l.papel as "user" | "assistant", texto: l.texto }));

  const [enviada] = await db
    .insert(iaMensagens)
    .values({ motoristaId: m.id, papel: "user", texto, imagemDados: foto ? foto.toString("base64") : null })
    .returning({ id: iaMensagens.id });

  try {
    let textoResposta: string;
    let via: "composio" | "direta";
    let imagemResposta: Buffer | null = null;
    if (criarImagem) {
      const r = await gerarImagemIA(texto, foto);
      imagemResposta = r.imagem;
      textoResposta = foto ? RESPOSTA_IMAGEM_EDITADA : RESPOSTA_IMAGEM_CRIADA;
      via = r.via;
    } else if (foto) {
      textoResposta = await analisarImagemIA(texto, foto, historico);
      via = "direta";
    } else {
      const r = await perguntarIA(texto, historico, m.id);
      textoResposta = r.texto;
      via = r.via;
    }
    const [salva] = await db
      .insert(iaMensagens)
      .values({
        motoristaId: m.id,
        papel: "assistant",
        texto: textoResposta,
        imagemDados: imagemResposta ? imagemResposta.toString("base64") : null,
      })
      .returning();
    // Guarda só as últimas 100 por motorista.
    await db.execute(
      sql`delete from ia_mensagens where motorista_id = ${m.id} and id < (select min(id) from (select id from ia_mensagens where motorista_id = ${m.id} order by id desc limit 100) s)`,
    ).catch(() => {});
    return NextResponse.json(
      {
        resposta: textoResposta,
        via,
        criadoEm: (salva?.criadoEm ?? new Date()).toISOString(),
        temImagem: Boolean(imagemResposta),
        idUsuario: enviada?.id ?? null,
        idResposta: salva?.id ?? null,
      },
      { headers: semCache },
    );
  } catch (e) {
    if (e instanceof ErroIA) {
      const status = e.codigo === "nao_configurada" ? 503 : 502;
      return NextResponse.json({ erro: e.message }, { status, headers: semCache });
    }
    return NextResponse.json({ erro: "A IA não respondeu. Tente de novo." }, { status: 502, headers: semCache });
  }
}

/** DELETE /api/ia/chat?motoristaId=1 → apaga a conversa e começa outra. */
export async function DELETE(req: Request) {
  await garantirTabelas();
  const url = new URL(req.url);
  const m = await motoristaOuErro(url.searchParams.get("motoristaId"));
  if (!m) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para falar com o assistente." }, { status: 403, headers: semCache });
  }
  await db.delete(iaMensagens).where(and(eq(iaMensagens.motoristaId, m.id)));
  return NextResponse.json({ ok: true }, { headers: semCache });
}
