import { NextResponse } from "next/server";
import { agendarTesteFechado, statusTesteFechado } from "@/lib/teste-fechado";

export const dynamic = "force-dynamic";

/**
 * Teste de notificação com o app fechado.
 *   { endpoint }                   → agenda: o próximo ciclo de leitura do
 *                                    servidor envia o aviso (pelo menos 20 s depois)
 *   { endpoint, acao: "status" }   → último teste deste aparelho e o resultado
 * O endpoint vai no corpo (POST), nunca na URL, para não aparecer em registros.
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const endpoint = typeof corpo?.endpoint === "string" ? corpo.endpoint.trim() : "";
  const semCache = { "Cache-Control": "no-store" };
  if (!/^https:\/\/\S{20,2048}$/.test(endpoint)) {
    return NextResponse.json({ erro: "Aparelho não identificado." }, { status: 400, headers: semCache });
  }

  if (corpo?.acao === "status") {
    const teste = await statusTesteFechado(endpoint);
    return NextResponse.json({ teste, agora: new Date().toISOString() }, { headers: semCache });
  }

  const r = await agendarTesteFechado(endpoint);
  if ("erro" in r) {
    return NextResponse.json({ erro: r.erro }, { status: r.status, headers: semCache });
  }
  return NextResponse.json({ teste: r.teste, agora: new Date().toISOString() }, { headers: semCache });
}
