import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitorDevices, monitorDeliveries, monitorMessages, motoristas, pontos, subscriptions } from "@/db/schema";

/** Conta inativa: mais de 15 dias sem abrir o app e sem número na fila. */
export const DIAS_INATIVIDADE = 15;
const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * Perfil some da contagem quando passou de 15 dias sem entrar E não monitora
 * nenhum número. No 15º dia ainda permanece; no dia seguinte, sai.
 */
export function contaInativaParaExcluir(opts: {
  ultimoAcessoEm: Date | null;
  criadoEm: Date;
  temNumeroMonitorado: boolean;
  agora?: Date;
}) {
  if (opts.temNumeroMonitorado) return false;
  const referencia = opts.ultimoAcessoEm ?? opts.criadoEm;
  const agora = opts.agora ?? new Date();
  return agora.getTime() - referencia.getTime() > DIAS_INATIVIDADE * MS_DIA;
}

/** Remove o cadastro e os números/aparelhos ligados a ele. O chat antigo fica. */
export async function excluirCadastroMotorista(motoristaId: number) {
  const devices = await db
    .select({ id: monitorDevices.id })
    .from(monitorDevices)
    .where(eq(monitorDevices.motoristaId, motoristaId));
  const deviceIds = devices.map((d) => d.id);
  if (deviceIds.length) {
    await db.delete(monitorDeliveries).where(inArray(monitorDeliveries.deviceId, deviceIds));
    await db.delete(monitorMessages).where(inArray(monitorMessages.monitorDeviceId, deviceIds));
  }
  await db.delete(subscriptions).where(eq(subscriptions.motoristaId, motoristaId));
  await db.delete(pontos).where(eq(pontos.motoristaId, motoristaId));
  await db.delete(motoristas).where(eq(motoristas.id, motoristaId));
}

/** Cron: apaga quem ficou mais de 15 dias sem entrar e sem ponto monitorado. */
export async function limparMotoristasInativos(agora = new Date()) {
  const limite = new Date(agora.getTime() - DIAS_INATIVIDADE * MS_DIA);
  const candidatos = await db
    .select({ id: motoristas.id })
    .from(motoristas)
    .where(sql`COALESCE(${motoristas.ultimoAcessoEm}, ${motoristas.criadoEm}) < ${limite}
      AND NOT EXISTS (SELECT 1 FROM pontos p WHERE p.motorista_id = ${motoristas.id})`);

  let excluidos = 0;
  for (const c of candidatos) {
    try {
      await excluirCadastroMotorista(c.id);
      excluidos += 1;
    } catch {
      // Um cadastro com restrição pontual não interrompe os demais.
    }
  }
  return { excluidos, candidatos: candidatos.length };
}
