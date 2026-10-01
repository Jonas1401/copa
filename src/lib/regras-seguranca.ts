import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { pontos, regrasEnvios } from "@/db/schema";
import { enviarPush } from "@/lib/push";

/**
 * Regras de segurança do Porto (chamado pelo /api/cron, a cada minuto).
 *
 * Quando o ponto de um motorista SAI PARA O TRABALHO (status SAIU depois de
 * ter aparecido no quadro), o CopaLinks manda as 11 regras, uma de cada vez,
 * ao longo do serviço: a 1ª um minuto depois do aviso de saída e as seguintes
 * a cada INTERVALO_MS, enquanto a saída tiver no máximo JANELA_MS.
 * Vai só para os aparelhos do próprio motorista, pelo Web Push do app.
 * Não altera nada da fila: só lê os pontos que já saíram.
 */

export const REGRAS: { titulo: string; texto: string }[] = [
  { titulo: "REGRA 01 — FARÓIS 🚛", texto: "🚨 Atenção, motorista: dentro do Porto, mantenha os faróis acesos durante a circulação." },
  { titulo: "REGRA 02 — SINALIZAÇÃO 💡", texto: "🚨 Atenção, motorista: antes de circular, verifique se as luzes de pisca e freio estão funcionando corretamente." },
  { titulo: "REGRA 03 — LONA 🚛", texto: "🚨 Atenção, motorista: mantenha a lona fechada durante a circulação, conforme as regras do Porto." },
  { titulo: "REGRA 04 — VELOCIDADE ⚠️", texto: "🚨 Atenção, motorista: respeite rigorosamente o limite de velocidade dentro do Porto." },
  { titulo: "REGRA 05 — VIAS LIVRES 🚧", texto: "🚨 Atenção, motorista: não bloqueie as vias. Mantenha a circulação do Porto livre e segura." },
  { titulo: "REGRA 06 — LOCAL PROIBIDO 🛑", texto: "🚨 Atenção, motorista: não pare em local proibido. Respeite a sinalização e as áreas autorizadas." },
  { titulo: "REGRA 07 — FUMAR 🚭", texto: "🚨 Atenção, motorista: fume somente em locais sinalizados e permitidos." },
  { titulo: "REGRA 08 — ESCADA LATERAL ⚠️", texto: "🚨 Atenção, motorista: não suba na escada lateral do funil. Respeite as áreas de segurança." },
  { titulo: "REGRA 09 — BEIRADA DO COSTADO ⚓", texto: "🚨 Atenção, motorista: não se aproxime da beirada do costado. Respeite as limitações e áreas de segurança." },
  { titulo: "REGRA 10 — GUINDASTE ⚠️", texto: "🚨 Atenção, motorista: durante o carregamento, não permaneça atrás do caminhão, devido ao giro e movimentação do guindaste. Mantenha distância segura." },
  { titulo: "REGRA 11 — SEGURANÇA SEMPRE 🦺", texto: "🚨 Atenção, motorista: dentro do Porto, respeite a sinalização, os limites e as orientações de segurança. Sua segurança vem em primeiro lugar." },
];

/** A 1ª regra sai 1 min depois da saída (o aviso "saiu para o trabalho" chega antes). */
export const ATRASO_INICIAL_MS = 60_000;
/** Uma regra a cada 30 min: as 11 cobrem cerca de 5 h de serviço. */
export const INTERVALO_MS = 30 * 60_000;
/** Saídas com mais de 6 h já não recebem regras. */
export const JANELA_MS = 6 * 60 * 60_000;

/** Qual regra (índice) mandar agora, ou null se não é hora. Função pura. */
export function proximaRegra(
  saidaEm: Date,
  enviadas: number,
  ultimoEnvioEm: Date | null,
  agora: Date,
): number | null {
  const desdeSaida = agora.getTime() - saidaEm.getTime();
  if (enviadas >= REGRAS.length) return null;
  if (desdeSaida < ATRASO_INICIAL_MS || desdeSaida > JANELA_MS) return null;
  if (ultimoEnvioEm && agora.getTime() - ultimoEnvioEm.getTime() < INTERVALO_MS) return null;
  return enviadas;
}

type Enviar = typeof enviarPush;

/** Nunca joga erro para cima: o cron não pode quebrar por causa das regras. */
export async function enviarRegrasSeguranca(
  agora: Date = new Date(),
  enviar: Enviar = enviarPush,
): Promise<{ enviadas: number; motoristas: number }> {
  try {
    const inicioJanela = new Date(agora.getTime() - JANELA_MS);
    // Só saídas reais: o ponto apareceu no quadro (vistoEm) e saiu (saidaEm).
    // Ponto "fora da tabela" logo no cadastro (sem vistoEm) não conta.
    const saidas = await db
      .select({ motoristaId: pontos.motoristaId, saidaEm: pontos.saidaEm })
      .from(pontos)
      .where(and(
        eq(pontos.status, "SAIU"),
        isNotNull(pontos.motoristaId),
        isNotNull(pontos.vistoEm),
        isNotNull(pontos.saidaEm),
        gt(pontos.saidaEm, inicioJanela),
      ))
      .orderBy(desc(pontos.saidaEm));

    // Uma sequência por motorista: a saída mais recente dele.
    const porMotorista = new Map<number, Date>();
    for (const s of saidas) {
      if (s.motoristaId && s.saidaEm && !porMotorista.has(s.motoristaId)) porMotorista.set(s.motoristaId, s.saidaEm);
    }

    let enviadas = 0;
    for (const [motoristaId, saidaEm] of porMotorista) {
      const chave = `${motoristaId}:${saidaEm.toISOString()}`;
      await db.insert(regrasEnvios).values({ chave, motoristaId }).onConflictDoNothing();
      const [reg] = await db.select().from(regrasEnvios).where(eq(regrasEnvios.chave, chave)).limit(1);
      if (!reg) continue;
      const indice = proximaRegra(saidaEm, reg.enviadas, reg.ultimoEnvioEm, agora);
      if (indice === null) continue;

      // Reserva a vez antes de enviar: dois ciclos ao mesmo tempo não duplicam.
      const [reservado] = await db.update(regrasEnvios)
        .set({ enviadas: indice + 1, ultimoEnvioEm: agora })
        .where(and(eq(regrasEnvios.chave, chave), eq(regrasEnvios.enviadas, indice)))
        .returning({ chave: regrasEnvios.chave });
      if (!reservado) continue;

      const regra = REGRAS[indice];
      await enviar(
        {
          title: regra.titulo,
          body: regra.texto,
          tag: `REGRA_${String(indice + 1).padStart(2, "0")}_M${motoristaId}_${saidaEm.getTime()}`,
          acao: "regra-seguranca",
          url: "/",
          actions: [{ action: "fechar", title: "Entendi 👍" }],
        },
        { motoristaId, unica: true },
      ).catch(() => null);
      enviadas++;
    }

    // Guarda só os últimos 3 dias.
    await db.delete(regrasEnvios).where(lt(regrasEnvios.criadoEm, sql`now() - interval '3 days'`));
    return { enviadas, motoristas: porMotorista.size };
  } catch {
    return { enviadas: 0, motoristas: 0 };
  }
}
