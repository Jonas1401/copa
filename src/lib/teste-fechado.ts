import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { motoristas, pontos, subscriptions, testesPush } from "@/db/schema";
import { enviarPush } from "@/lib/push";
import { codigoDe, garantirTabelas, ROTULO_TIPO, type Tipo } from "@/lib/estado";

/**
 * Teste de notificação COM O APP FECHADO.
 *
 * O botão no app só AGENDA o teste. Quem envia é o ciclo de leitura do
 * servidor (/api/cron, chamado a cada minuto pelo agendador do Supabase),
 * exatamente o mesmo caminho dos avisos reais de chamada — por isso o teste
 * prova que o aviso chega sem a página aberta.
 *
 *   1. aparelho pede → linha em `testes_push` com enviar_apos = agora + 20 s
 *      (tempo para o motorista fechar o app);
 *   2. primeiro ciclo depois disso → faz a leitura da fila → envia o Web Push
 *      com a posição atualizada do ponto;
 *   3. o app, quando reaberto, mostra se o servidor enviou e a que horas.
 */

export const ESPERA_MINIMA_S = 20;
const VALIDADE_MIN = 15; // pedido não enviado em 15 min não é mais enviado
const LIMITE_POR_HORA = 12;

export type ResultadoTeste = "aguardando" | "enviando" | "enviado" | "falhou" | "sem_inscricao" | "expirado";

export type StatusTesteFechado = {
  id: number;
  pedidoEm: string;
  enviarApos: string;
  processadoEm: string | null;
  resultado: ResultadoTeste;
};

type Linha = typeof testesPush.$inferSelect;

function formatar(t: Linha): StatusTesteFechado {
  let resultado = (t.resultado as ResultadoTeste | null) ?? "aguardando";
  if (!t.processadoEm && Date.now() - t.pedidoEm.getTime() > VALIDADE_MIN * 60_000) {
    resultado = "expirado";
  }
  return {
    id: t.id,
    pedidoEm: t.pedidoEm.toISOString(),
    enviarApos: t.enviarApos.toISOString(),
    processadoEm: t.processadoEm ? t.processadoEm.toISOString() : null,
    resultado,
  };
}

async function inscricaoAtiva(endpoint: string) {
  const [s] = await db
    .select({ id: subscriptions.id, motoristaId: subscriptions.motoristaId })
    .from(subscriptions)
    .where(and(eq(subscriptions.endpoint, endpoint), eq(subscriptions.ativa, 1)))
    .limit(1);
  return s ?? null;
}

/** Agenda o teste deste aparelho (ou devolve o que já está aguardando). */
export async function agendarTesteFechado(
  endpoint: string,
): Promise<{ teste: StatusTesteFechado } | { erro: string; status: number }> {
  await garantirTabelas();
  if (!(await inscricaoAtiva(endpoint))) {
    return {
      erro: "Este aparelho não está inscrito para receber avisos. Toque em Ativar notificações e teste de novo.",
      status: 404,
    };
  }

  const [pendente] = await db
    .select()
    .from(testesPush)
    .where(
      and(
        eq(testesPush.endpoint, endpoint),
        isNull(testesPush.processadoEm),
        gt(testesPush.pedidoEm, sql`now() - make_interval(mins => ${VALIDADE_MIN})`),
      ),
    )
    .orderBy(desc(testesPush.id))
    .limit(1);
  if (pendente) return { teste: formatar(pendente) };

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(testesPush)
    .where(and(eq(testesPush.endpoint, endpoint), gt(testesPush.pedidoEm, sql`now() - interval '1 hour'`)));
  if ((n ?? 0) >= LIMITE_POR_HORA) {
    return { erro: "Muitos testes seguidos. Espere alguns minutos e tente de novo.", status: 429 };
  }

  const [novo] = await db
    .insert(testesPush)
    .values({ endpoint, enviarApos: sql`now() + make_interval(secs => ${ESPERA_MINIMA_S})` })
    .returning();
  await db.execute(sql`delete from testes_push where pedido_em < now() - interval '2 days'`);
  return { teste: formatar(novo) };
}

/** Último teste pedido por este aparelho (para o app mostrar o resultado). */
export async function statusTesteFechado(endpoint: string): Promise<StatusTesteFechado | null> {
  await garantirTabelas();
  const [t] = await db
    .select()
    .from(testesPush)
    .where(eq(testesPush.endpoint, endpoint))
    .orderBy(desc(testesPush.id))
    .limit(1);
  return t ? formatar(t) : null;
}

async function corpoDoTeste(motoristaId: number | null, hora: string) {
  let nome: string | null = null;
  if (motoristaId) {
    const [m] = await db
      .select({ nome: motoristas.nome })
      .from(motoristas)
      .where(eq(motoristas.id, motoristaId))
      .limit(1);
    nome = m?.nome ?? null;
  }
  // Só os pontos do dono deste aparelho (aparelho sem dono: nenhum).
  const lista = motoristaId
    ? await db
        .select()
        .from(pontos)
        .where(eq(pontos.motoristaId, motoristaId))
        .orderBy(pontos.ordem, pontos.id)
        .limit(3)
    : [];
  const linhas = lista.map((p) => {
    const rotulo = `${ROTULO_TIPO[p.tipo as Tipo] ?? p.tipo} ${codigoDe(p.livro, p.numero)}`;
    if (p.status === "NA VEZ") return `${rotulo}: na vez!`;
    if (p.status === "SAIU") return `${rotulo}: saiu da fila`;
    return `${rotulo}: ${p.naFrente} na frente`;
  });
  return [
    `${nome ? `Olá, ${nome}! ` : ""}✅ Teste com o app fechado`,
    `Enviada pelo servidor no ciclo de leitura das ${hora}.`,
    ...(linhas.length ? linhas : ["Nenhum ponto monitorado agora."]),
  ].join("\n");
}

/**
 * Chamado pelo /api/cron DEPOIS da leitura da fila. Envia os testes vencidos.
 * Nunca lança erro: um problema aqui não pode atrapalhar o monitoramento.
 */
export async function enviarTestesDoCiclo(): Promise<{ total: number; enviados: number }> {
  try {
    await garantirTabelas();
    // Reserva atômica: dois ciclos simultâneos nunca enviam o mesmo teste.
    const devidos = await db
      .update(testesPush)
      .set({ processadoEm: sql`now()`, resultado: "enviando" })
      .where(
        and(
          isNull(testesPush.processadoEm),
          lte(testesPush.enviarApos, sql`now()`),
          gt(testesPush.pedidoEm, sql`now() - make_interval(mins => ${VALIDADE_MIN})`),
        ),
      )
      .returning();
    if (!devidos.length) return { total: 0, enviados: 0 };

    const hora = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
    let enviados = 0;
    for (const t of devidos) {
      let resultado: ResultadoTeste = "falhou";
      try {
        const inscricao = await inscricaoAtiva(t.endpoint);
        if (!inscricao) {
          resultado = "sem_inscricao";
        } else {
          const r = await enviarPush(
            {
              title: "🚛 Monitor Ponto CopaLinks",
              body: await corpoDoTeste(inscricao.motoristaId, hora),
              tag: `TESTE_FECHADO_${t.id}`,
              acao: "teste",
              url: "/",
              requireInteraction: true,
              actions: [{ action: "ver-monitor", title: "Ver monitor" }],
            },
            { somenteEndpoint: t.endpoint, unica: false },
          );
          const descartadas = "descartadas" in r ? (r.descartadas ?? 0) : 0;
          if (r.enviadas > 0) {
            resultado = "enviado";
            enviados += 1;
          } else if (descartadas > 0) {
            resultado = "sem_inscricao"; // o serviço de push disse que a inscrição venceu
          }
        }
      } catch (e) {
        console.error("[teste-fechado] envio", e);
      }
      await db
        .update(testesPush)
        .set({ resultado, processadoEm: sql`now()` })
        .where(eq(testesPush.id, t.id));
    }
    return { total: devidos.length, enviados };
  } catch (e) {
    console.error("[teste-fechado]", e);
    return { total: 0, enviados: 0 };
  }
}
