import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";

export const dynamic = "force-dynamic";

const MIME_PERMITIDOS = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/3gpp",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

type Params = { params: Promise<{ id: string }> };

/** Serve um único anexo por vez; o polling do chat só recebe os metadados. */
export async function GET(req: Request, { params }: Params) {
  await garantirTabelas();
  const { id: valorId } = await params;
  const id = Number(valorId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ erro: "Anexo não encontrado." }, { status: 404 });
  }

  const [mensagem] = await db
    .select({
      dados: chatMensagens.mediaDados,
      mime: chatMensagens.mediaTipo,
      nome: chatMensagens.mediaNome,
    })
    .from(chatMensagens)
    .where(eq(chatMensagens.id, id))
    .limit(1);

  if (!mensagem?.dados || !mensagem.mime || !MIME_PERMITIDOS.has(mensagem.mime)) {
    return NextResponse.json({ erro: "Anexo não encontrado." }, { status: 404 });
  }

  const bytes = Buffer.from(mensagem.dados, "base64");
  const range = req.headers.get("range");
  const nomeCodificado = encodeURIComponent(mensagem.nome ?? "anexo").replace(/[!'()*]/g, (caractere) => `%${caractere.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = new Headers({
    "Content-Type": mensagem.mime,
    "Content-Disposition": `${mensagem.mime.startsWith("audio/") || mensagem.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${nomeCodificado}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      headers.set("Content-Range", `bytes */${bytes.length}`);
      return new NextResponse(null, { status: 416, headers });
    }
    const inicio = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2] || 0));
    const fimSolicitado = match[2] && match[1] ? Number(match[2]) : bytes.length - 1;
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fimSolicitado) || inicio >= bytes.length || inicio > fimSolicitado) {
      headers.set("Content-Range", `bytes */${bytes.length}`);
      return new NextResponse(null, { status: 416, headers });
    }
    const fim = Math.min(fimSolicitado, bytes.length - 1);
    const parte = new Uint8Array(bytes.subarray(inicio, fim + 1));
    headers.set("Content-Length", String(parte.byteLength));
    headers.set("Content-Range", `bytes ${inicio}-${fim}/${bytes.length}`);
    return new NextResponse(parte, { status: 206, headers });
  }

  const corpo = new Uint8Array(bytes);
  headers.set("Content-Length", String(corpo.byteLength));
  return new NextResponse(corpo, { headers });
}
