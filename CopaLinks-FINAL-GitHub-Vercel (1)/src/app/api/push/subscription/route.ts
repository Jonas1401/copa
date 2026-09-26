import { NextResponse } from "next/server";
import { removerSubscription, salvarSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Recebe e armazena a Push Subscription criada no navegador. */
export async function POST(req: Request) {
  try {
    const corpo = await req.json();
    const dispositivo = String(
      corpo?.dispositivo ?? req.headers.get("user-agent") ?? "",
    ).slice(0, 180);
    const motoristaId = Number.isInteger(Number(corpo?.motoristaId)) && Number(corpo?.motoristaId) > 0
      ? Number(corpo.motoristaId)
      : null;
    const resultado = await salvarSubscription(
      corpo?.subscription ?? corpo,
      dispositivo,
      motoristaId,
    );
    return NextResponse.json(resultado);
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : "Subscription inválida." },
      { status: 400 },
    );
  }
}

/** Descarta uma assinatura (quando o usuário revoga ou o navegador expira). */
export async function DELETE(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const endpoint = String(
    corpo?.endpoint ?? new URL(req.url).searchParams.get("endpoint") ?? "",
  );
  if (!endpoint) {
    return NextResponse.json({ erro: "Endpoint ausente." }, { status: 400 });
  }
  return NextResponse.json(await removerSubscription(endpoint));
}
