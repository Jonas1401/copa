import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { ErroBanner, infoBanner, processarBanner, removerBanner } from "@/lib/banner";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";
// Gerar a imagem pelo Composio pode levar algumas dezenas de segundos.
export const maxDuration = 60;
const CAB = { "Cache-Control": "private, no-store" };

// Freio: até 6 imagens por hora por motorista (o gerador tem custo).
const envios = new Map<number, number[]>();
function podeEnviar(id: number) {
  const agora = Date.now();
  const lista = (envios.get(id) ?? []).filter((t) => agora - t < 3_600_000);
  if (lista.length >= 6) return false;
  lista.push(agora);
  envios.set(id, lista);
  return true;
}

/** GET → { versao, via } da imagem deste motorista (null = usa a imagem padrão). */
export async function GET() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const b = await infoBanner(m.id);
  return NextResponse.json({ versao: b?.versao ?? null, via: b?.via ?? null }, { headers: CAB });
}

/** POST multipart (campo "foto") → trata a foto e salva como imagem do topo deste motorista. */
export async function POST(req: Request) {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  if (!podeEnviar(m.id)) {
    return NextResponse.json({ erro: "Você já trocou a imagem várias vezes nesta hora. Tente mais tarde." }, { status: 429, headers: CAB });
  }
  let foto: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("foto");
    foto = f instanceof File ? f : null;
  } catch {
    foto = null;
  }
  if (!foto) return NextResponse.json({ erro: "Nenhuma foto recebida. Tente de novo." }, { status: 400, headers: CAB });
  try {
    const r = await processarBanner(m.id, Buffer.from(await foto.arrayBuffer()), foto.type);
    return NextResponse.json({ ok: true, ...r }, { headers: CAB });
  } catch (e) {
    const status = e instanceof ErroBanner ? e.status : 502;
    const erro = e instanceof ErroBanner ? e.message : "Não foi possível processar a imagem. Tente novamente.";
    return NextResponse.json({ erro }, { status, headers: CAB });
  }
}

/** DELETE → volta para a imagem padrão do CopaLinks. */
export async function DELETE() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  await removerBanner(m.id);
  return NextResponse.json({ ok: true }, { headers: CAB });
}
