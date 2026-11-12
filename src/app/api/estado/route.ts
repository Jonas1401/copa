import { after, NextResponse } from "next/server";
import { tickRadar } from "@/lib/clima-monitor";
import {
  montarEstado,
  processarSaidasPendentes,
  temPontoCadastrado,
  varrerSeVelho,
} from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import { acessoPortalDoMotorista, garantirTabelasPortal, INTERVALO_LEITURA_MS, monitorarSeDevido, ultimaLeituraPortal } from "@/lib/portal-copadubo";
import { normalizarCodigoPortal } from "@/lib/portal-copadubo-parse";
import { atualizarFilaEntreCiclos, monitorarStatusEmSegundoPlano } from "@/lib/portal-monitor";
import { fontePortal, situacaoFresca, situacoesDoMotorista } from "@/lib/portal-situacao";
import { pontoEmDispensa } from "@/lib/portal-status-ponto";

export const dynamic = "force-dynamic";
/**
 * A resposta sai em até 1,5 s; o que roda depois dela (`after`) pode incluir
 * uma consulta ao Portal do Motorista, que leva alguns segundos.
 */
export const maxDuration = 60;

const PRAZO_RESPOSTA = 1500;
/** Depois disto (contado do fim da resposta) a leitura da fila entre ciclos não começa mais nesta chamada. */
const PRAZO_PARA_COMECAR_A_FILA_MS = 35_000;

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
    // Fonte `quadro`: a regra de quando reler o portal é uma só (a mesma do
    // cron): só com um ponto do motorista fora do quadro e respeitando o
    // intervalo entre logins.
    await monitorarSeDevido(id);
  } catch { /* A próxima consulta tentará novamente. */ }
  finally { atualizando.delete(id); }
}

// Saídas que esperam a consulta ao portal: uma rodada por vez nesta instância.
let conferindoSaidas = false;
async function conferirSaidasNoPortal() {
  if (conferindoSaidas) return;
  conferindoSaidas = true;
  try {
    await processarSaidasPendentes();
  } catch { /* O cron (ou a próxima chamada) retoma: a espera fica gravada. */ }
  finally { conferindoSaidas = false; }
}

export async function GET() {
  try {
    // Com ponto monitorado, cada chamada pode carregar uma varredura nova do
    // site — nunca mais que 1,5s de espera; o resto termina em segundo plano.
    let varredura: Promise<unknown> | null = null;
    if (await temPontoCadastrado()) {
      varredura = varrerSeVelho().catch(() => null);
      await comPrazo(varredura, PRAZO_RESPOSTA);
    }
    const motorista = await motoristaDaSessao();
    const estado = await montarEstado(motorista?.id ?? null);
    // A dispensa é uma informação do portal, independente do estado da fila.
    // Uma falha ou leitura antiga nunca deve inventar uma dispensa atual.
    let ultimaPortal: Awaited<ReturnType<typeof ultimaLeituraPortal>> = null;
    let portalAtivo = false;
    // Fonte `portal` (o padrão): a saída do ponto é avisada pelo Status do
    // Portal do Motorista. O app mostra a situação lida lá e diz ao motorista
    // quando falta o cadastro do acesso — sem ele não há aviso de saída.
    const fonte = fontePortal();
    if (motorista && estado.pontos.length) {
      try {
        const acesso = await acessoPortalDoMotorista(motorista.id);
        portalAtivo = acesso?.ativo === 1;
        if (fonte === "portal") {
          estado.avisoSaida = portalAtivo ? "portal" : acesso ? "pausado" : "sem_acesso";
          if (portalAtivo) {
            const situacoes = await situacoesDoMotorista(motorista.id);
            estado.pontos = estado.pontos.map((p) => {
              const lida = situacoes.find((s) => s.pontoId === p.id && s.codigo === normalizarCodigoPortal(p.codigo));
              const turno = lida && situacaoFresca(lida) ? lida.turno : null;
              return { ...p, situacaoPortal: turno, emDispensa: turno === "EM DISPENSA" };
            });
          }
        } else {
          estado.avisoSaida = "quadro";
          if (portalAtivo) {
            ultimaPortal = await ultimaLeituraPortal(motorista.id);
            estado.pontos = estado.pontos.map((p) => ({ ...p, emDispensa: pontoEmDispensa(ultimaPortal, p) }));
          }
        }
      } catch { /* O portal não pode impedir a exibição da fila. */ }
    }
    // Radar da previsão: o app aberto chama esta rota o tempo todo, então é
    // aqui que o monitoramento do tempo continua vivo quando o /api/cron do
    // provedor não roda a cada minuto. Custa uma comparação de horário na
    // maior parte das vezes; nunca joga erro nem atrasa a resposta da fila.
    await tickRadar().catch(() => null);
    // Portal do motorista: as tabelas nascem na primeira abertura do app (o
    // motorista não depende de ninguém rodar SQL para ver a tela) e as idas ao
    // portal rodam em segundo plano, depois da resposta.
    const temPontoFora = estado.pontos.some((p) => p.status === "SAIU");
    after(async () => {
      const inicioDoSegundoPlano = Date.now();
      await garantirTabelasPortal().catch(() => null);
      // A varredura desta chamada pode ainda estar em andamento — e é ela que
      // descobre que um ponto saiu do quadro.
      if (varredura) await varredura;
      // Fonte `quadro`: ponto que acabou de sair do quadro é conferido no
      // portal antes do aviso (não depende de o cron rodar a cada minuto).
      // Com a fonte `portal` não sobra nada aqui além de uma saída agendada
      // antes da troca da fonte.
      await conferirSaidasNoPortal();
      if (fonte === "portal") {
        // O app aberto mantém a leitura do Status em dia (uma rodada curta,
        // para todos os motoristas com a leitura vencida).
        await monitorarStatusEmSegundoPlano();
      } else if (motorista && portalAtivo && temPontoFora && (!ultimaPortal || Date.now() - ultimaPortal.criadoEm.getTime() >= INTERVALO_LEITURA_MS)) {
        await atualizarPortal(motorista.id);
      }
      // A fila entre as olhadas do Status: com o app aberto, a aba “Fila” do
      // portal é relida sem esperar o próximo ciclo de 1 minuto. Vem por
      // último (o Status é quem avisa a saída) e só começa se ainda sobra
      // tempo folgado desta função para a leitura inteira (até 14 s).
      if (Date.now() - inicioDoSegundoPlano < PRAZO_PARA_COMECAR_A_FILA_MS) await atualizarFilaEntreCiclos().catch(() => null);
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
