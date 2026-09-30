import { and, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitorCodes, monitorDeliveries, monitorMessages, motoristas, pontos } from "@/db/schema";
import { enviarPush } from "@/lib/push";
import { marcarAtivo } from "@/lib/auth";
import {
  analisarMensagemGrupo,
  formatarCodigo,
  lerCodigo,
  type AnaliseGrupo,
  type ListaGrupo,
} from "@/lib/grupo-filtro";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";

/**
 * Filtro automático do grupo "INFO. OP PORTO / FOSPAR **" (SOMENTE servidor).
 *
 * O Monitor Android (NotificationListenerService) envia o texto da mensagem
 * mais recente do grupo. Aqui o texto é analisado em memória e DESCARTADO:
 * no banco ficam só metadados (ID do evento e quantidade de códigos). Cada
 * motorista recebe, pelo Web Push que o CopaLinks já usa, apenas o aviso do
 * PRÓPRIO ponto:
 *   🔔 Ponto na vez nº A014
 *   ⚠️ Ponto pulado nº A137
 *
 * Comparação sempre pelo código completo (livro + número): A014 ≠ A140.
 * Nada aqui altera a fila, os pontos ou os avisos NA VEZ/SAIU do quadro.
 */

const LIMITE_EVENTOS_MINUTO = 30;
const FUSO = "America/Sao_Paulo";

export type DestinoGrupo = { motoristaId: number; lista: ListaGrupo; codigo: string };

export function textoDoAviso(lista: ListaGrupo, codigo: string) {
  return lista === "NA_VEZ"
    ? {
        title: `🔔 Ponto na vez nº ${codigo}`,
        body: `Seu ponto ${codigo} está na lista PONTOS NA VEZ do grupo ${NOME_GRUPO_MONITORADO}.`,
      }
    : {
        title: `⚠️ Ponto pulado nº ${codigo}`,
        body: `Seu ponto ${codigo} está na lista de PULADAS do grupo ${NOME_GRUPO_MONITORADO}.`,
      };
}

/**
 * Motoristas donos de cada código da mensagem. Usa os pontos cadastrados no
 * app (tabela `pontos`) e os códigos do Monitor WhatsApp (`monitor_codes`).
 */
export async function encontrarDestinos(analise: AnaliseGrupo): Promise<DestinoGrupo[]> {
  const lidos = [...new Set([...analise.naVez, ...analise.pulados])]
    .map(lerCodigo)
    .filter((c): c is NonNullable<ReturnType<typeof lerCodigo>> => Boolean(c));
  if (!lidos.length) return [];

  const porLivro = new Map<string, number[]>();
  for (const c of lidos) porLivro.set(c.livro, [...(porLivro.get(c.livro) ?? []), c.numero]);
  const condicoes = [...porLivro].map(([livro, numeros]) =>
    and(eq(pontos.livro, livro), inArray(pontos.numero, numeros)),
  );

  const [dosPontos, doMonitor] = await Promise.all([
    db.select({ motoristaId: pontos.motoristaId, livro: pontos.livro, numero: pontos.numero })
      .from(pontos)
      .where(and(isNotNull(pontos.motoristaId), or(...condicoes))),
    db.select({ motoristaId: monitorCodes.motoristaId, codigo: monitorCodes.codigo })
      .from(monitorCodes)
      .where(and(eq(monitorCodes.ativo, 1), inArray(monitorCodes.codigo, lidos.map((c) => `${c.livro}${c.numero}`)))),
  ]);

  // código "A014" → motoristas que têm esse ponto
  const donos = new Map<string, Set<number>>();
  const adicionar = (codigo: string, motoristaId: number | null) => {
    if (!motoristaId) return;
    if (!donos.has(codigo)) donos.set(codigo, new Set());
    donos.get(codigo)!.add(motoristaId);
  };
  for (const p of dosPontos) adicionar(formatarCodigo(p.livro, p.numero), p.motoristaId);
  for (const m of doMonitor) {
    const c = /^([ABM])(\d{1,3})$/.exec(m.codigo);
    if (c) adicionar(formatarCodigo(c[1], Number(c[2])), m.motoristaId);
  }

  const destinos: DestinoGrupo[] = [];
  for (const [lista, codigos] of [["NA_VEZ", analise.naVez], ["PULADO", analise.pulados]] as const) {
    for (const codigo of codigos) {
      for (const motoristaId of donos.get(codigo) ?? []) destinos.push({ motoristaId, lista, codigo });
    }
  }
  return destinos;
}

type Enviar = typeof enviarPush;

/**
 * Entrega pelo Web Push existente, SÓ para os aparelhos do dono do ponto.
 * Trava de repetição: o mesmo aviso (lista + código + motorista) sai no
 * máximo uma vez por dia (fuso de São Paulo), mesmo que o grupo repita a lista.
 */
export async function avisarDestinos(destinos: DestinoGrupo[], enviar: Enviar = enviarPush) {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date()).replace(/-/g, "");
  let avisados = 0;
  let semAparelho = 0;
  let repetidos = 0;
  let falhas = 0;
  for (let i = 0; i < destinos.length; i += 10) {
    await Promise.all(destinos.slice(i, i + 10).map(async (d) => {
      const { title, body } = textoDoAviso(d.lista, d.codigo);
      try {
        const r = await enviar(
          {
            title,
            body,
            tag: `WA_${d.lista}_${d.codigo}_M${d.motoristaId}_${dia}`,
            acao: d.lista === "NA_VEZ" ? "grupo-na-vez" : "grupo-pulado",
            url: "/",
            requireInteraction: true,
            actions: [
              { action: "ver-monitor", title: "Abrir CopaLinks" },
              { action: "fechar", title: "Fechar" },
            ],
          },
          { motoristaId: d.motoristaId, unica: true },
        );
        if (r.enviadas > 0) avisados++;
        else if (r.erro?.includes("já enviada")) repetidos++;
        else if (r.erro?.includes("Nenhuma assinatura")) semAparelho++;
        else falhas++;
      } catch {
        falhas++;
      }
    }));
  }
  return { avisados, semAparelho, repetidos, falhas };
}

function resumoCodigos(a: AnaliseGrupo) {
  return [
    ...(a.naVez.length ? [`NA VEZ: ${a.naVez.length} códigos`] : []),
    ...(a.pulados.length ? [`PULADAS: ${a.pulados.length} códigos`] : []),
  ];
}

/** Mensagem recebida do Monitor Android pareado. O texto não é gravado. */
export async function processarMensagemGrupo(
  device: { id: number },
  entrada: { eventId: string; origem: string; texto: string },
  enviar: Enviar = enviarPush,
) {
  const analise = analisarMensagemGrupo(entrada.texto);
  const base = { naVez: analise.naVez.length, pulados: analise.pulados.length };
  await marcarAtivo(device.id);
  if (!base.naVez && !base.pulados) {
    return { ...base, ignorada: true, duplicada: false, limite: false, destinos: 0, avisados: 0, semAparelho: 0, repetidos: 0, falhas: 0 };
  }

  // Mesma retenção do monitor existente (7 dias; primeiro os resultados, pela FK).
  await db.delete(monitorDeliveries).where(lt(monitorDeliveries.criadoEm, sql`now() - interval '7 days'`));
  await db.delete(monitorMessages).where(lt(monitorMessages.criadoEm, sql`now() - interval '7 days'`));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(monitorMessages)
    .where(and(eq(monitorMessages.monitorDeviceId, device.id), gt(monitorMessages.criadoEm, sql`now() - interval '1 minute'`)));
  if ((n ?? 0) >= LIMITE_EVENTOS_MINUTO) {
    return { ...base, ignorada: false, duplicada: false, limite: true, destinos: 0, avisados: 0, semAparelho: 0, repetidos: 0, falhas: 0 };
  }

  const [nova] = await db.insert(monitorMessages)
    .values({ monitorDeviceId: device.id, eventId: entrada.eventId, origem: entrada.origem, codigos: resumoCodigos(analise) })
    .onConflictDoNothing()
    .returning({ id: monitorMessages.id });
  if (!nova) {
    return { ...base, ignorada: false, duplicada: true, limite: false, destinos: 0, avisados: 0, semAparelho: 0, repetidos: 0, falhas: 0 };
  }

  const destinos = await encontrarDestinos(analise);
  const r = await avisarDestinos(destinos, enviar);
  return { ...base, ignorada: false, duplicada: false, limite: false, destinos: destinos.length, ...r };
}

/** Painel do administrador: mostra o que o filtro encontraria (e, se pedido, envia). */
export async function simularMensagemGrupo(texto: string, opcoes: { enviar?: boolean } = {}, enviar: Enviar = enviarPush) {
  const analise = analisarMensagemGrupo(texto);
  const destinos = await encontrarDestinos(analise);
  const ids = [...new Set(destinos.map((d) => d.motoristaId))];
  const nomes = ids.length
    ? await db.select({ id: motoristas.id, nome: motoristas.nome }).from(motoristas).where(inArray(motoristas.id, ids))
    : [];
  const nomeDe = new Map(nomes.map((m) => [m.id, m.nome]));
  const entrega = opcoes.enviar ? await avisarDestinos(destinos, enviar) : null;
  return {
    naVez: analise.naVez,
    pulados: analise.pulados,
    avisos: destinos.map((d) => ({
      motorista: nomeDe.get(d.motoristaId) ?? `Motorista ${d.motoristaId}`,
      aviso: textoDoAviso(d.lista, d.codigo).title,
    })),
    entrega,
  };
}
