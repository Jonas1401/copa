import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, motoristas } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { notificarMensagemChat } from "@/lib/chat-push";
import { listarReacoes, type ReacaoChat } from "@/lib/chat-reacoes";
import { chatVisivel } from "@/lib/chat-politica";

export const dynamic = "force-dynamic";
// Tempo para gravar a mensagem E aguardar o envio do Web Push aos aparelhos.
export const maxDuration = 30;

/** Mensagens ficam 7 dias; depois somem sozinhas. */
const DIAS_GUARDADOS = 7;
const TAMANHO_MAX = 500;
const TAMANHO_MAX_MIDIA = 4 * 1024 * 1024;

type LinhaTela = Pick<
  typeof chatMensagens.$inferSelect,
  "id" | "motoristaId" | "nome" | "texto" | "tipo" | "mediaNome" | "mediaTipo" | "duracaoSegundos" | "criadoEm"
>;

/**
 * Nunca inclui os bytes do anexo na lista/polling. Arquivos são servidos em
 * /api/chat/:id/media, permitindo que mensagens antigas continuem leves.
 * As curtidas (reacoes) vêm junto para a pílula aparecer já no 1º desenho.
 */
const paraTela = (m: LinhaTela, reacoes?: ReacaoChat[]) => ({
  id: m.id,
  motoristaId: m.motoristaId,
  nome: m.nome,
  texto: m.texto,
  tipo: m.tipo || "texto",
  mediaNome: m.mediaNome,
  mediaTipo: m.mediaTipo,
  mediaUrl: m.mediaTipo ? `/api/chat/${m.id}/media` : null,
  duracaoSegundos: m.duracaoSegundos,
  criadoEm: m.criadoEm.toISOString(),
  reacoes: reacoes ?? [],
});

const camposTela = {
  id: chatMensagens.id,
  motoristaId: chatMensagens.motoristaId,
  nome: chatMensagens.nome,
  texto: chatMensagens.texto,
  tipo: chatMensagens.tipo,
  mediaNome: chatMensagens.mediaNome,
  mediaTipo: chatMensagens.mediaTipo,
  duracaoSegundos: chatMensagens.duracaoSegundos,
  criadoEm: chatMensagens.criadoEm,
};

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
          chatVisivel,
          gt(chatMensagens.id, Number.isFinite(contar) ? contar : 0),
          sql`${chatMensagens.motoristaId} <> ${eu}`,
        ),
      );
    return NextResponse.json({ novas: n ?? 0 }, { headers: cab });
  }

  const depois = Number(url.searchParams.get("depois"));
  if (Number.isFinite(depois) && depois > 0) {
    const novas = await db
      .select(camposTela)
      .from(chatMensagens)
      .where(and(chatVisivel, gt(chatMensagens.id, depois)))
      .orderBy(asc(chatMensagens.id))
      .limit(100);
    const reacoes = await listarReacoes(novas.map((m) => m.id));
    return NextResponse.json({ mensagens: novas.map((m) => paraTela(m, reacoes[m.id] ?? [])) }, { headers: cab });
  }

  const ultimas = await db.select(camposTela).from(chatMensagens).where(chatVisivel).orderBy(desc(chatMensagens.id)).limit(80);
  const reacoes = await listarReacoes(ultimas.map((m) => m.id));
  return NextResponse.json({ mensagens: ultimas.reverse().map((m) => paraTela(m, reacoes[m.id] ?? [])) }, { headers: cab });
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

const TIPOS_MIDIA = {
  audio: new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/3gpp"]),
  imagem: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]),
  arquivo: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.ms-excel",
  ]),
} as const;

type TipoMidia = keyof typeof TIPOS_MIDIA;

const MIME_POR_EXTENSAO: Record<string, string> = {
  aac: "audio/aac",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "audio/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeSeguro(tipoRecebido: string, nome: string) {
  const informado = tipoRecebido.toLowerCase().split(";")[0].trim();
  if (informado && informado !== "application/octet-stream") return informado;
  const extensao = nome.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_POR_EXTENSAO[extensao] ?? informado;
}

function nomeSeguro(nome: string) {
  return nome
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 120) || "anexo";
}

export async function POST(req: Request) {
  await garantirTabelas();

  let motoristaId = 0;
  let texto = "";
  let tipo: TipoMidia | "texto" = "texto";
  let mediaNome: string | null = null;
  let mediaTipo: string | null = null;
  let mediaDados: string | null = null;
  let duracaoSegundos: number | null = null;

  if (req.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    const tamanhoPedido = Number(req.headers.get("content-length"));
    if (Number.isFinite(tamanhoPedido) && tamanhoPedido > TAMANHO_MAX_MIDIA + 128 * 1024) {
      return NextResponse.json({ erro: "O anexo precisa ter até 4 MB." }, { status: 413 });
    }
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ erro: "Não foi possível ler o anexo." }, { status: 400 });
    motoristaId = Number(form.get("motoristaId"));
    const tipoTexto = String(form.get("tipo") ?? "");
    const arquivo = form.get("arquivo");
    if (!(Object.prototype.hasOwnProperty.call(TIPOS_MIDIA, tipoTexto)) || !(arquivo instanceof File)) {
      return NextResponse.json({ erro: "Escolha um arquivo compatível para enviar." }, { status: 400 });
    }
    const tipoInformado = tipoTexto as TipoMidia;
    if (!arquivo.size || arquivo.size > TAMANHO_MAX_MIDIA) {
      return NextResponse.json({ erro: "O arquivo precisa ter até 4 MB." }, { status: 413 });
    }

    const nome = nomeSeguro(arquivo.name || (tipoInformado === "audio" ? "recado-audio.webm" : "anexo"));
    const mime = mimeSeguro(arquivo.type, nome);
    const formatosAceitos: ReadonlySet<string> = TIPOS_MIDIA[tipoInformado];
    if (!formatosAceitos.has(mime)) {
      return NextResponse.json({ erro: "Formato não compatível. Envie áudio, imagem ou documento permitido." }, { status: 415 });
    }

    tipo = tipoInformado;
    mediaNome = nome;
    mediaTipo = mime;
    mediaDados = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
    const valorDuracao = form.get("duracaoSegundos");
    const duracaoRecebida = valorDuracao === null ? Number.NaN : Number(valorDuracao);
    duracaoSegundos = tipo === "audio" && Number.isFinite(duracaoRecebida) && duracaoRecebida > 0
      ? Math.min(60 * 60, Math.max(1, Math.round(duracaoRecebida)))
      : null;
    texto = tipo === "audio" ? "🎙️ Mensagem de áudio" : tipo === "imagem" ? `📷 ${nome}` : `📎 ${nome}`;
  } else {
    const corpo = await req.json().catch(() => ({}));
    motoristaId = Number(corpo?.motoristaId);
    texto = String(corpo?.texto ?? "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, TAMANHO_MAX);
  }

  if (!texto) return NextResponse.json({ erro: "Escreva a mensagem." }, { status: 400 });
  if (!Number.isInteger(motoristaId) || motoristaId <= 0) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para usar o chat." }, { status: 403 });
  }
  const [m] = await db.select().from(motoristas).where(eq(motoristas.id, motoristaId)).limit(1);
  if (!m) return NextResponse.json({ erro: "Cadastre seu nome no app para usar o chat." }, { status: 403 });
  if (!podeEnviar(m.id)) {
    return NextResponse.json({ erro: "Muitas mensagens seguidas. Aguarde um minuto." }, { status: 429 });
  }

  const [nova] = await db
    .insert(chatMensagens)
    .values({
      motoristaId: m.id,
      nome: m.nome,
      texto,
      tipo,
      mediaNome,
      mediaTipo,
      mediaDados,
      duracaoSegundos,
    })
    .returning(camposTela);
  await db
    .delete(chatMensagens)
    .where(lt(chatMensagens.criadoEm, sql`now() - make_interval(days => ${DIAS_GUARDADOS})`));

  // Web Push leva somente um resumo, nunca os bytes do arquivo.
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
