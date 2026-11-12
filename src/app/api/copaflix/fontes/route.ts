import { NextResponse } from "next/server";
import { DEMONSTRACAO } from "@/lib/copaflix/catalogo";

/**
 * Disponibilidade das fontes do catálogo de demonstração.
 *
 * Roda no SERVIDOR porque é ele quem tem rede livre: o seu aparelho pode ter
 * bloqueio da operadora e o servidor não (ou o contrário). Só endereços que
 * estão no próprio catálogo são verificados — nada de URL vinda da tela —,
 * então não há como usar esta rota para sondar a rede interna (SSRF).
 *
 * Resposta: { fontes: [{ rotulo, ok, status }] }. Cache de 5 minutos.
 */

type Checagem = { rotulo: string; ok: boolean; status?: number };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { em: number; valor: { fontes: Checagem[] } }>();

async function bater(url: string, metodo: "HEAD" | "GET"): Promise<Response> {
  return fetch(url, {
    method: metodo,
    headers: metodo === "GET" ? { Range: "bytes=0-0" } : undefined,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
}

async function checar(url: string): Promise<{ ok: boolean; status?: number }> {
  try {
    let resposta = await bater(url, "HEAD");
    // Alguns servidores recusam HEAD: aí vale um GET de 1 byte.
    if ([403, 405, 501].includes(resposta.status)) resposta = await bater(url, "GET");
    return { ok: resposta.ok || resposta.status === 206, status: resposta.status };
  } catch {
    return { ok: false };
  }
}

export async function GET(requisicao: Request) {
  const id = new URL(requisicao.url).searchParams.get("id") ?? "";
  const titulo = DEMONSTRACAO.find((item) => item.id === id);
  if (!titulo) {
    return NextResponse.json({ erro: "Título desconhecido no catálogo." }, { status: 404 });
  }

  const guardado = cache.get(id);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return NextResponse.json(guardado.valor, { headers: { "Cache-Control": "no-store" } });
  }

  const fontes = [titulo.fonte, ...(titulo.fontesAlternativas ?? [])].filter(
    (fonte) => Boolean(fonte?.url?.startsWith("https://")),
  );

  const avaliadas = await Promise.all(
    fontes.map(async (fonte) => ({
      rotulo: fonte!.rotulo ?? "fonte",
      ...(await checar(fonte!.url as string)),
    })),
  );

  const valor = { fontes: avaliadas };
  cache.set(id, { em: Date.now(), valor });
  return NextResponse.json(valor, { headers: { "Cache-Control": "no-store" } });
}
