import { NextResponse } from "next/server";
import { garantirTabelas, garantirSemente, temPontoCadastrado } from "@/lib/estado";
import { varrer } from "@/lib/estado";
import { garantirAdminDefault } from "@/lib/admin/auth";
import { enviarTestesDoCiclo } from "@/lib/teste-fechado";
import { verificarClima } from "@/lib/clima-alerta";
import { verificarMudancasPrevisao } from "@/lib/clima-monitor";
import { verificarNaviosFertilizantes } from "@/lib/navios-aviso";
import { enviarRegrasSeguranca } from "@/lib/regras-seguranca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despertador do monitoramento.
 *
 * Esta rota é o despertador do monitoramento quando nenhum navegador está
 * aberto. Ela deve ser chamada aproximadamente a cada 1 minuto por Vercel Cron
 * (Pro/Enterprise) ou por um cron externo. O Service Worker recebe o Push e
 * mostra a notificação mesmo com o aplicativo fechado.
 *
 * A rota é protegida por CRON_SECRET (Vercel) ou SUPABASE_CRON_SECRET (pg_cron)
 * quando uma dessas variáveis estiver definida. A chave do Supabase é
 * independente para não invalidar o agendador da Vercel já configurado.
 */
export async function GET(req: Request) {
  // Vercel envia Authorization: Bearer <CRON_SECRET> automaticamente.
  // pg_cron no Supabase usa SUPABASE_CRON_SECRET, guardado no Supabase Vault.
  // Nunca enviamos nenhuma das duas chaves ao navegador.
  const segredos = [
    process.env.CRON_SECRET?.trim(),
    process.env.SUPABASE_CRON_SECRET?.trim(),
  ].filter((s): s is string => Boolean(s));
  if (segredos.length) {
    const autorizacao = req.headers.get("authorization") ?? "";
    if (!segredos.some((segredo) => autorizacao === `Bearer ${segredo}`)) {
      return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    }
  }

  await garantirTabelas();
  await garantirAdminDefault();
  await garantirSemente();

  // Testes "com o app fechado" pedidos pelos aparelhos saem neste ciclo,
  // depois da leitura (o aviso leva a posição atualizada do ponto).
  // O clima também roda aqui (mesmo sem ponto, os motoristas precisam saber
  // do tempo no porto): alerta em tempo ruim ou boletim de previsão do turno.
  if (!(await temPontoCadastrado())) {
    const testes = await enviarTestesDoCiclo();
    const clima = await verificarClima().catch(() => null);
    // Radar da previsão (Composio + SIMPORT): avisa QUALQUER mudança no tempo.
    const radar = await verificarMudancasPrevisao({
      previsao: clima?.previsao,
      registrarSomente: Boolean(clima?.postou),
    }).catch(() => null);
    const navios = await verificarNaviosFertilizantes().catch(() => null);
    return NextResponse.json({
      rodou: false,
      motivo: "Nenhum ponto cadastrado — monitoramento em repouso.",
      ...(testes.total ? { testes } : {}),
      ...(clima?.postou ? { clima } : {}),
      ...(radar?.postou ? { radar } : {}),
      ...(navios?.rodou ? { navios } : {}),
    });
  }

  let testes = { total: 0, enviados: 0 };
  let leitura: Awaited<ReturnType<typeof varrer>>;
  try {
    leitura = await varrer({ forcarRede: true });
  } finally {
    testes = await enviarTestesDoCiclo();
  }
  const clima = await verificarClima().catch(() => null);
  // Radar da previsão: compara a leitura atual (API da Simport + painel lido
  // pelo Composio) com a do último aviso e manda qualquer mudança para o chat.
  const radar = await verificarMudancasPrevisao({
    previsao: clima?.previsao,
    registrarSomente: Boolean(clima?.postou),
  }).catch(() => null);
  // Navios de fertilizantes (APPA + SINPRAPAR): no máximo a cada 5 min.
  const navios = await verificarNaviosFertilizantes().catch(() => null);
  // Regras de segurança do Porto para quem saiu para o trabalho.
  const regras = await enviarRegrasSeguranca().catch(() => null);
  const tabelas = Object.values(leitura.fila).filter((l) => l.codigos.length);
  return NextResponse.json({
    rodou: true,
    origem: leitura.origem,
    tabelas: tabelas.length,
    quando: new Date().toISOString(),
    ...(testes.total ? { testes } : {}),
    ...(clima?.postou ? { clima } : {}),
    ...(radar?.postou ? { radar } : {}),
    ...(navios?.rodou ? { navios } : {}),
    ...(regras?.enviadas ? { regras } : {}),
  });
}
