import { NextResponse } from "next/server";
import { garantirTabelas, garantirSemente, temPontoCadastrado, varrer } from "@/lib/estado";
import { garantirAdminDefault } from "@/lib/admin/auth";
import { enviarTestesDoCiclo } from "@/lib/teste-fechado";
import { verificarNaviosFertilizantes } from "@/lib/navios-aviso";
import { limparMotoristasInativos } from "@/lib/motorista-inatividade";
import { monitorarTodos } from "@/lib/portal-copadubo";
import { verificarSaidasRecentes } from "@/lib/portal-saida";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Despertador de backend: fila pessoal + leitura de navios HTTP/Composio + avisos.
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
  const inativos = await limparMotoristasInativos().catch(() => ({ excluidos: 0, candidatos: 0 }));

  // O monitor de navios é independente de pontos cadastrados e de falhas da
  // fila. As leituras HTTP diretas/Composio acontecem em paralelo no cron.
  const tarefaNavios = verificarNaviosFertilizantes().catch(() => null);
  // Portal do motorista: cada ciclo lê quem já passou do intervalo (5 min).
  // Um portal fora do ar nunca impede a fila nem os navios.
  const tarefaPortal = monitorarTodos().catch(() => null);
  // Saída do ponto: quem saiu da tela agora é lido no portal do motorista
  // (turno, trabalho e dispensa) — só roda se o administrador ligou o teste.
  const tarefaSaida = verificarSaidasRecentes().catch(() => null);
  if (!(await temPontoCadastrado())) {
    const testes = await enviarTestesDoCiclo();
    const navios = await tarefaNavios;
    const portal = await tarefaPortal;
    const saidaNada = await tarefaSaida;
    return NextResponse.json({
      rodou: false, motivo: "Nenhum ponto cadastrado — monitoramento da fila em repouso.",
      ...(testes.total ? { testes } : {}), ...(navios ? { navios } : {}),
      ...(portal?.lidos ? { portal } : {}),
      ...(saidaNada?.tentados ? { saida: { tentados: saidaNada.tentados } } : {}),
      ...(inativos.excluidos ? { inativos } : {}),
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
  const portal = await tarefaPortal;
  const saida = await tarefaSaida;
  return NextResponse.json({
    rodou: Boolean(leitura),
    ...(leitura ? {
      origem: leitura.origem, tabelas: Object.values(leitura.fila).filter((l) => l.codigos.length).length,
    } : { motivo: "Falha temporária na leitura da fila." }),
    quando: new Date().toISOString(),
    ...(testes.total ? { testes } : {}), ...(navios ? { navios } : {}),
    ...(portal?.lidos ? { portal } : {}),
    ...(inativos.excluidos ? { inativos } : {}),
  });
}
