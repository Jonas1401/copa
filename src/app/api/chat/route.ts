import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, motoristas } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { notificarMensagemChat } from "@/lib/chat-push";

export const dynamic = "force-dynamic";
// Tempo para gravar a mensagem E aguardar o envio do Web Push aos aparelhos.
export const maxDuration = 30;

/** Mensagens ficam 7 dias; depois somem sozinhas. */
const DIAS_GUARDADOS = 7;
const TAMANHO_MAX = 500;

type Linha = typeof chatMensagens.$inferSelect;
const paraTela = (m: Linha) => ({
  id: m.id,
  motoristaId: m.motoristaId,
  nome: m.nome,
  texto: m.texto,
  criadoEm: m.criadoEm.toISOString(),
});

/**
 * GET /api/chat              → últimas 80 mensagens
 * GET /api/chat?depois=ID    → só as novas (a tela pergunta a cada 4 s)
 * GET /api/chat?contar=ID    → quantas chegaram depois de ID (bolinha do rodapé)
 */
export async function GET(req: Request) {
  await garantirTabelas();
  const url = new URL(req.url);
  const cab = { "Cache-Control": "no-store" };

  const contar = Number(url.searchParams.get("contar"));
  if (url.searchParams.has("contar")) {
    const eu = Number(url.searchParams.get("eu")) || 0;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(chatMensagens)
      .where(
        and(
          gt(chatMensagens.id, Number.isFinite(contar) ? contar : 0),
          sql`${chatMensagens.motoristaId} <> ${eu}`,
        ),
      );
    return NextResponse.json({ novas: n ?? 0 }, { headers: cab });
  }

  const depois = Number(url.searchParams.get("depois"));
  if (Number.isFinite(depois) && depois > 0) {
    const novas = await db
      .select()
      .from(chatMensagens)
      .where(gt(chatMensagens.id, depois))
      .orderBy(asc(chatMensagens.id))
      .limit(100);
    return NextResponse.json({ mensagens: novas.map(paraTela) }, { headers: cab });
  }

  const ultimas = await db.select().from(chatMensagens).orderBy(desc(chatMensagens.id)).limit(80);
  return NextResponse.json({ mensagens: ultimas.reverse().map(paraTela) }, { headers: cab });
}

// Freio contra enxurrada: até 8 mensagens por minuto por motorista.
const envios = new Map<number, number[]>();
function podeEnviar(id: number) {
  const agora = Date.now();
  const lista = (envios.get(id) ?? []).filter((t) => agora - t < 60_000);
  if (lista.length >= 8) return false;
  lista.push(agora);
  envios.set(id, lista);
  return true;
}

export async function POST(req: Request) {
  await garantirTabelas();
  const corpo = await req.json().catch(() => ({}));
  const motoristaId = Number(corpo?.motoristaId);
  const texto = String(corpo?.texto ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TAMANHO_MAX);

  if (!texto) return NextResponse.json({ erro: "Escreva a mensagem." }, { status: 400 });
  if (!Number.isInteger(motoristaId) || motoristaId <= 0) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para usar o chat." }, { status: 403 });
  }
  const [m] = await db.select().from(motoristas).where(eq(motoristas.id, motoristaId)).limit(1);
  if (!m) return NextResponse.json({ erro: "Cadastre seu nome no app para usar o chat." }, { status: 403 });
  if (!podeEnviar(m.id)) {
    return NextResponse.json({ erro: "Muitas mensagens seguidas. Aguarde um minuto." }, { status: 429 });
  }

  const [nova] = await db.insert(chatMensagens).values({ motoristaId: m.id, nome: m.nome, texto }).returning();
  await db
    .delete(chatMensagens)
    .where(lt(chatMensagens.criadoEm, sql`now() - make_interval(days => ${DIAS_GUARDADOS})`));

  // Web Push "nome + mensagem" para os outros aparelhos, mesmo com o app
  // fechado. Aguardamos o envio (na Vercel a função encerra ao responder);
  // uma falha no Push nunca impede a mensagem de ser publicada.
  const push = await notificarMensagemChat({
    id: nova.id,
    motoristaId: nova.motoristaId,
    nome: nova.nome,
    texto: nova.texto,
  }).catch(() => null);

  return NextResponse.json(
    { mensagem: paraTela(nova), push: push ? { enviadas: push.enviadas, aparelhos: push.assinaturas } : null },
    { status: 201 },
  );
}
