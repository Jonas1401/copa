import { NextResponse } from "next/server";
import { garantirTabelas, garantirSemente, temPontoCadastrado } from "@/lib/estado";
import { varrer } from "@/lib/estado";
import { garantirAdminDefault } from "@/lib/admin/auth";
import { enviarTestesDoCiclo } from "@/lib/teste-fechado";
import { verificarEPostarAlertaClima } from "@/lib/clima-alerta";
import { verificarNaviosFertilizantes } from "@/lib/navios-aviso";
import { enviarRegrasSeguranca } from "@/lib/regras-seguranca";
import { validarWakeToken } from "@/lib/cron-wake";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despertador do monitoramento.
 *
 * Esta rota é o despertador do monitoramento quando nenhum navegador está
 * aberto. Ela deve ser chamada aproximadamente a cada 1 minuto por Vercel Cron
 * (Pro/Enterprise), GitHub Actions (plano Hobby/free), Supabase pg_cron, ou
 * pelo próprio Service Worker do app (usando um wake token curto).
 *
 * Autorização (qualquer uma basta):
 *   1. Authorization: Bearer <CRON_SECRET> — Vercel Cron;
 *   2. Authorization: Bearer <SUPABASE_CRON_SECRET> — pg_cron do Supabase;
 *   3. X-Wake-Token: <token> — Service Worker (pega o token em /api/cron/wake);
 *   4. Sem segredo configurado: roda (modo de desenvolvimento ou primeira
 *      configuração).
 */
export async function GET(req: Request) {
  const segredos = [
    process.env.CRON_SECRET?.trim(),
    process.env.SUPABASE_CRON_SECRET?.trim(),
  ].filter((s): s is string => Boolean(s));
  const temSegredoConfigurado = segredos.length > 0;
  const autorizacao = req.headers.get("authorization") ?? "";
  const wakeToken = req.headers.get("x-wake-token") ?? "";
  const bearerValido = temSegredoConfigurado
    ? segredos.some((segredo) => autorizacao === `Bearer ${segredo}`)
    : true;
  const wakeValido = await validarWakeToken(wakeToken).catch(() => false);
  if (temSegredoConfigurado && !bearerValido && !wakeValido) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  await garantirTabelas();
  await garantirAdminDefault();
  await garantirSemente();

  // Testes "com o app fechado" pedidos pelos aparelhos saem neste ciclo,
  // depois da leitura (o aviso leva a posição atualizada do ponto).
  // O alerta inteligente do clima também roda aqui (mesmo sem ponto,
  // os motoristas precisam saber do tempo no porto).
  if (!(await temPontoCadastrado())) {
    const testes = await enviarTestesDoCiclo();
    const clima = await verificarEPostarAlertaClima().catch(() => null);
    const navios = await verificarNaviosFertilizantes().catch(() => null);
    return NextResponse.json({
      rodou: false,
      motivo: "Nenhum ponto cadastrado — monitoramento em repouso.",
      ...(testes.total ? { testes } : {}),
      ...(clima?.postou ? { clima } : {}),
      ...(navios?.rodou ? { navios } : {}),
    });
  }

  let testes = { total: 0, enviados: 0 };
  let leitura: Awaited<ReturnType<typeof varrer>> | null = null;
  let erroVarrer: string | null = null;
  try {
    leitura = await varrer({ forcarRede: true });
  } catch (e) {
    erroVarrer = e instanceof Error ? e.message : String(e);
  } finally {
    testes = await enviarTestesDoCiclo().catch(() => ({ total: 0, enviados: 0 }));
  }
  // Clima e navios SEMPRE rodam (mesmo se a varredura da fila falhar),
  // porque motoristas com app aberto ou fechado precisam desses avisos
  // mesmo quando a Copadubo está fora do ar.
  const clima = await verificarEPostarAlertaClima().catch(() => null);
  const navios = await verificarNaviosFertilizantes().catch(() => null);
  // Regras de segurança: só faz sentido se há leitura válida.
  const regras = leitura ? await enviarRegrasSeguranca().catch(() => null) : null;
  const tabelas = leitura
    ? Object.values(leitura.fila).filter((l) => l.codigos.length).length
    : 0;
  return NextResponse.json({
    rodou: Boolean(leitura),
    ...(leitura ? { origem: leitura.origem, tabelas } : { erro: erroVarrer }),
    quando: new Date().toISOString(),
    ...(testes.total ? { testes } : {}),
    ...(clima?.postou ? { clima } : {}),
    ...(navios?.rodou ? { navios } : {}),
    ...(regras?.enviadas ? { regras } : {}),
  });
}
