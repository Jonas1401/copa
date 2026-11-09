import { after, NextResponse } from "next/server";
import { tickRadar } from "@/lib/clima-monitor";
import {
  montarEstado,
  temPontoCadastrado,
  varrerSeVelho,
} from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import { acessoPortalDoMotorista, garantirTabelasPortal, INTERVALO_LEITURA_MS, monitorarMotorista, ultimaLeituraPortal } from "@/lib/portal-copadubo";
import { pontoEmDispensa } from "@/lib/portal-status-ponto";

export const dynamic = "force-dynamic";

const PRAZO_RESPOSTA = 1500;

function comPrazo<T>(tarefa: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    tarefa.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

// Evita logins simultâneos na mesma instância enquanto o portal responde.
const atualizando = new Set<number>();
async function atualizarPortal(id: number) {
  if (atualizando.has(id)) return;
  atualizando.add(id);
  try {
    const ultima = await ultimaLeituraPortal(id);
    if (!ultima || Date.now() - ultima.criadoEm.getTime() >= INTERVALO_LEITURA_MS) {
      await monitorarMotorista(id);
    }
  } catch { /* A próxima consulta tentará novamente. */ }
  finally { atualizando.delete(id); }
}

export async function GET() {
  try {
    // Com ponto monitorado, cada chamada pode carregar uma varredura nova do
    // site — nunca mais que 1,5s de espera; o resto termina em segundo plano.
    if (await temPontoCadastrado()) {
      await comPrazo(varrerSeVelho(), PRAZO_RESPOSTA);
    }
    const motorista = await motoristaDaSessao();
    const estado = await montarEstado(motorista?.id ?? null);
    // A dispensa é uma informação do portal, independente do estado da fila.
    // Uma falha ou leitura antiga nunca deve inventar uma dispensa atual.
    let ultimaPortal: Awaited<ReturnType<typeof ultimaLeituraPortal>> = null;
    let portalAtivo = false;
    if (motorista && estado.pontos.length) {
      try {
        const acesso = await acessoPortalDoMotorista(motorista.id);
        portalAtivo = acesso?.ativo === 1;
        if (portalAtivo) {
          ultimaPortal = await ultimaLeituraPortal(motorista.id);
          estado.pontos = estado.pontos.map((p) => ({ ...p, emDispensa: pontoEmDispensa(ultimaPortal, p) }));
        }
      } catch { /* O portal não pode impedir a exibição da fila. */ }
    }
    // Radar da previsão: o app aberto chama esta rota o tempo todo, então é
    // aqui que o monitoramento do tempo continua vivo quando o /api/cron do
    // provedor não roda a cada minuto. Custa uma comparação de horário na
    // maior parte das vezes; nunca joga erro nem atrasa a resposta da fila.
    await tickRadar().catch(() => null);
    // Portal do motorista: as tabelas nascem na primeira abertura do app (o
    // motorista não depende de ninguém rodar SQL para ver a tela) e a checagem
    // de atualização do portal roda em segundo plano.
    after(async () => {
      await garantirTabelasPortal().catch(() => null);
      if (motorista && portalAtivo && (!ultimaPortal || Date.now() - ultimaPortal.criadoEm.getTime() >= INTERVALO_LEITURA_MS)) {
        await atualizarPortal(motorista.id);
      }
    });
    return NextResponse.json(estado, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return NextResponse.json(
      { erro: "Falha ao ler o monitor" + String(erro) },
      { status: 500 },
    );
  }
}
