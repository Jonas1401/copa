import { db } from "@/db";
import { eq, inArray, sql } from "drizzle-orm";
import { configuracao, naviosAvisos, notificacoes, subscriptions } from "@/db/schema";
import { ultimoResultadoAlertas } from "@/lib/alertas-fallback";
import { totalAssinaturas } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico rápido do monitor.
 *
 * GET /api/health → status do banco e, quando há CRON_SECRET ou o pedido
 * vem de admin, também o estado dos alertas (última execução do cron,
 * do fallback, assinaturas ativas e últimos avisos de clima/navios).
 */
export async function GET(req: Request) {
  try {
    const inicio = Date.now();
    await db.execute(sql`select 1`);

    const autorizacao = req.headers.get("authorization") ?? "";
    const segredo = process.env.CRON_SECRET?.trim();
    const segredoSupabase = process.env.SUPABASE_CRON_SECRET?.trim();
    const autenticado =
      (segredo && autorizacao === `Bearer ${segredo}`) ||
      (segredoSupabase && autorizacao === `Bearer ${segredoSupabase}`);

    const base = {
      ok: true,
      quando: new Date().toISOString(),
      demoradoMs: Date.now() - inicio,
    };

    if (!autenticado) return Response.json(base);

    const chaves = [
      "clima_ultimo_aviso_chat",
      "navios_semeado",
      "navios_ultima_verificacao",
      "alertas_fallback_ultimo",
    ];
    const linhas = await db
      .select()
      .from(configuracao)
      .where(inArray(configuracao.chave, chaves));
    const porChave = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));

    const [assinaturas, ultimosNavios] = await Promise.all([
      totalAssinaturas().catch(() => 0),
      db
        .select({ chave: naviosAvisos.chave, navio: naviosAvisos.navio, criadoEm: naviosAvisos.criadoEm })
        .from(naviosAvisos)
        .orderBy(sql`${naviosAvisos.criadoEm} desc`)
        .limit(5),
    ]);

    const fallbackBruto = porChave["alertas_fallback_ultimo"];
    const ultimaNavios = Number(porChave["navios_ultima_verificacao"]) || null;
    const climaUltimo = (() => {
      try { return porChave["clima_ultimo_aviso_chat"] ? JSON.parse(porChave["clima_ultimo_aviso_chat"]) : null; }
      catch { return null; }
    })();

    const agora = Date.now();
    return Response.json({
      ...base,
      assinaturas,
      cron: {
        // Avaliação heurística: se o fallback rodou mais recentemente que
        // a marca de navios, provavelmente o cron externo não está vivo.
        navios_ultima_verificacao: ultimaNavios ? new Date(ultimaNavios).toISOString() : null,
        navios_atraso_ms: ultimaNavios ? agora - ultimaNavios : null,
        semeado: Boolean(porChave["navios_semeado"]),
      },
      clima: {
        ultimo_aviso: climaUltimo
          ? { nivel: climaUltimo.nivel, titulo: climaUltimo.titulo, em: new Date(climaUltimo.em).toISOString() }
          : null,
      },
      fallback: fallbackBruto
        ? (() => {
            try { return JSON.parse(fallbackBruto); } catch { return null; }
          })()
        : null,
      fallback_em_memoria: ultimoResultadoAlertas(),
      ultimos_navios_avisados: ultimosNavios.map((n) => ({
        chave: n.chave,
        navio: n.navio,
        criadoEm: n.criadoEm,
      })),
      variaveis: {
        tem_cron_secret: Boolean(segredo),
        tem_supabase_cron_secret: Boolean(segredoSupabase),
        tem_vapid: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        tem_composio: Boolean(process.env.COMPOSIO_API_KEY),
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, erro: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
