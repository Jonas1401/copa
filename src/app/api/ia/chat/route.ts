import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { iaMensagens } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import { ErroIA, perguntarIA } from "@/lib/ia";

export const dynamic = "force-dynamic";

const PERGUNTA_MAX = 1000;
const HISTORICO_CTX = 10; // últimas trocas enviadas à IA como contexto
const HISTORICO_TELA = 40; // mensagens devolvidas para a tela

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
  const url = new URL(req.url);
  const m = await motoristaOuErro(url.searchParams.get("motoristaId"));
  if (!m) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para falar com o assistente." }, { status: 403, headers: semCache });
  }
  const linhas = await db
    .select()
    .from(iaMensagens)
    .where(eq(iaMensagens.motoristaId, m.id))
    .orderBy(desc(iaMensagens.id))
    .limit(HISTORICO_TELA);
  const mensagens = linhas.reverse().map((l) => ({
    papel: l.papel,
    texto: l.texto,
    criadoEm: l.criadoEm.toISOString(),
  }));
  return NextResponse.json({ mensagens }, { headers: semCache });
}

/** POST /api/ia/chat { motoristaId, texto } → pergunta e recebe a resposta. */
export async function POST(req: Request) {
  await garantirTabelas();
  const corpo = await req.json().catch(() => ({}));
  const m = await motoristaOuErro(corpo?.motoristaId);
  if (!m) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para falar com o assistente." }, { status: 403, headers: semCache });
  }
  const texto = String(corpo?.texto ?? "").trim().slice(0, PERGUNTA_MAX);
  if (!texto) return NextResponse.json({ erro: "Escreva sua pergunta." }, { status: 400, headers: semCache });
  if (!podePerguntar(m.id)) {
    return NextResponse.json({ erro: "Muitas perguntas seguidas. Aguarde um pouco." }, { status: 429, headers: semCache });
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

  await db.insert(iaMensagens).values({ motoristaId: m.id, papel: "user", texto });

  try {
    const r = await perguntarIA(texto, historico, m.id);
    const [salva] = await db
      .insert(iaMensagens)
      .values({ motoristaId: m.id, papel: "assistant", texto: r.texto })
      .returning();
    // Guarda só as últimas 100 por motorista.
    await db.execute(
      sql`delete from ia_mensagens where motorista_id = ${m.id} and id < (select min(id) from (select id from ia_mensagens where motorista_id = ${m.id} order by id desc limit 100) s)`,
    ).catch(() => {});
    return NextResponse.json(
      {
        resposta: r.texto,
        via: r.via,
        criadoEm: (salva?.criadoEm ?? new Date()).toISOString(),
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
