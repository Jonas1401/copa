import { verificarEPostarAlertaClima } from "@/lib/clima-alerta";
import { verificarNaviosFertilizantes } from "@/lib/navios-aviso";
import { db } from "@/db";
import { configuracao } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Fallback de alertas em background (SOMENTE servidor).
 *
 * Os alertas de clima e de navios de fertilizantes rodam "de verdade" no
 * /api/cron, que deve ser chamado a cada minuto pela Vercel Cron (Pro),
 * pelo Supabase pg_cron (Hobby) ou por um cron externo. Quando nenhum
 * desses agendadores está ativo (por exemplo, em Hobby sem Supabase),
 * esta função é chamada pelas rotas que o navegador já busca com
 * frequência (ex.: /api/atualizar) e dispara as mesmas verificações.
 *
 * NUNCA joga erro para cima e NUNCA atrasa a resposta: roda depois que
 * a resposta já foi enviada, para não deixar o usuário esperando.
 */

const CHAVE_ULTIMO_FALLBACK = "alertas_fallback_ultimo";
/** No fallback do navegador, checamos no máximo a cada 2 min para não bater
 *  toda hora na APPA/Simport nem gastar cota de IA sem necessidade. */
const FALLBACK_INTERVALO_MS = 2 * 60_000;

export type AlertasEmBackgroundResult = {
  acionou: boolean;
  clima?: { postou: boolean; nivel: string; motivo: string };
  navios?: { rodou: boolean; motivo: string; eventos: number; avisados: string[] };
  demoradoMs?: number;
};

let rodando = false;
let ultimoResultado: AlertasEmBackgroundResult | null = null;

export function ultimoResultadoAlertas() {
  return ultimoResultado;
}

/**
 * Dispara a verificação de clima e navios em "fogo e esquece":
 * não espera a resposta e não quebra a requisição se algo der errado.
 */
export function dispararAlertasEmBackground() {
  // Evita sobreposição: se já estiver rodando, não enfileira de novo.
  if (rodando) return;
  rodando = true;
  const inicio = Date.now();
  void (async () => {
    try {
      const [clima, navios] = await Promise.all([
        verificarEPostarAlertaClima().catch(() => ({ postou: false, nivel: "?", motivo: "falha" }) as const),
        verificarNaviosFertilizantes().catch(() => ({ rodou: false, motivo: "falha", eventos: 0, avisados: [] as string[] }) as const),
      ]);
      ultimoResultado = {
        acionou: true,
        clima: { postou: clima.postou, nivel: clima.nivel, motivo: clima.motivo },
        navios: { rodou: navios.rodou, motivo: navios.motivo, eventos: navios.eventos, avisados: navios.avisados },
        demoradoMs: Date.now() - inicio,
      };
      // Marca no banco quando o fallback rodou pela última vez, para o
      // painel do admin/health saber se o cron externo está vivo.
      try {
        const valor = JSON.stringify({ em: Date.now(), resultado: ultimoResultado });
        await db
          .insert(configuracao)
          .values({ chave: CHAVE_ULTIMO_FALLBACK, valor })
          .onConflictDoUpdate({ target: configuracao.chave, set: { valor } })
          .catch(() => {});
      } catch {/* silencioso */}
    } finally {
      rodando = false;
    }
  })();
}

/**
 * Decide se já passou tempo suficiente desde o último fallback (evita
 * bater na APPA/Simport em TODO refresh de 5s do navegador).
 */
export async function deveRodarFallback() {
  if (rodando) return false;
  try {
    const [linha] = await db
      .select()
      .from(configuracao)
      .where(eq(configuracao.chave, CHAVE_ULTIMO_FALLBACK))
      .limit(1);
    if (!linha) return true;
    const t = JSON.parse(linha.valor) as { em?: number };
    if (!t?.em) return true;
    return Date.now() - t.em >= FALLBACK_INTERVALO_MS;
  } catch {
    return true;
  }
}
