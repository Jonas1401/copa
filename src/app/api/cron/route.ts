import { NextResponse } from "next/server";
import { garantirTabelas, garantirSemente, temPontoCadastrado, varrer } from "@/lib/estado";
import { garantirAdminDefault } from "@/lib/admin/auth";
import { enviarTestesDoCiclo } from "@/lib/teste-fechado";
import { verificarNaviosFertilizantes } from "@/lib/navios-aviso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Despertador de backend: fila pessoal + leitura Composio + avisos de navios.
 * Chamar a cada minuto (Supabase pg_cron ou Vercel Pro/Enterprise).
 * Cada fonte é relida a cada 5 min; a fila de envios é tratada em todo ciclo.
 * Não publica clima, boletins, boas-vindas ou regras de comportamento.
 * Nada muda no visual. O Service Worker existente recebe os avisos com o app fechado.
 */
export async function GET(req: Request) {
  const segredos = [process.env.CRON_SECRET?.trim(), process.env.SUPABASE_CRON_SECRET?.trim()]
    .filter((s): s is string => Boolean(s));
  if (segredos.length) {
    const autorizacao = req.headers.get("authorization") ?? "";
    if (!segredos.some((segredo) => autorizacao === `Bearer ${segredo}`)) {
      return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    }
  }

  await garantirTabelas();
  await garantirAdminDefault();
  await garantirSemente();

  // O monitor de navios é independente de pontos cadastrados e de falhas da
  // fila. A leitura Composio acontece em paralelo para caber no prazo do cron.
  const tarefaNavios = verificarNaviosFertilizantes().catch(() => null);
  if (!(await temPontoCadastrado())) {
    const testes = await enviarTestesDoCiclo();
    const navios = await tarefaNavios;
    return NextResponse.json({
      rodou: false, motivo: "Nenhum ponto cadastrado — monitoramento da fila em repouso.",
      ...(testes.total ? { testes } : {}), ...(navios ? { navios } : {}),
    });
  }

  let testes = { total: 0, enviados: 0 };
  let leitura: Awaited<ReturnType<typeof varrer>> | null = null;
  try {
    leitura = await varrer({ forcarRede: true });
  } catch {
    // Uma falha da fila não pode impedir a publicação dos avisos de navios.
  } finally {
    testes = await enviarTestesDoCiclo();
  }
  const navios = await tarefaNavios;
  return NextResponse.json({
    rodou: Boolean(leitura),
    ...(leitura ? {
      origem: leitura.origem, tabelas: Object.values(leitura.fila).filter((l) => l.codigos.length).length,
    } : { motivo: "Falha temporária na leitura da fila." }),
    quando: new Date().toISOString(),
    ...(testes.total ? { testes } : {}), ...(navios ? { navios } : {}),
  });
}
