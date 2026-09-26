import { NextResponse } from "next/server";
import { garantirTabelas, garantirSemente, temPontoCadastrado } from "@/lib/estado";
import { varrer } from "@/lib/estado";
import { garantirAdminDefault } from "@/lib/admin/auth";

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
 * A rota é protegida por CRON_SECRET quando essa variável estiver definida.
 */
export async function GET(req: Request) {
  // Vercel envia Authorization: Bearer <CRON_SECRET> automaticamente para
  // Cron Jobs quando CRON_SECRET está definido. Isso também permite usar a
  // mesma rota com um cron externo (cron-job.org, EasyCron etc.).
  const segredo = process.env.CRON_SECRET?.trim();
  if (segredo) {
    const autorizacao = req.headers.get("authorization") ?? "";
    if (autorizacao !== `Bearer ${segredo}`) {
      return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    }
  }

  await garantirTabelas();
  await garantirAdminDefault();
  await garantirSemente();

  if (!(await temPontoCadastrado())) {
    return NextResponse.json({
      rodou: false,
      motivo: "Nenhum ponto cadastrado — monitoramento em repouso.",
    });
  }

  const leitura = await varrer({ forcarRede: true });
  const tabelas = Object.values(leitura.fila).filter((l) => l.codigos.length);
  return NextResponse.json({
    rodou: true,
    origem: leitura.origem,
    tabelas: tabelas.length,
    quando: new Date().toISOString(),
  });
}
