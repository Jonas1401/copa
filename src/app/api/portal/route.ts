import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import {
  acessoPortalDoMotorista,
  acessoPublico,
  garantirTabelasPortal,
  monitorarMotorista,
  removerAcessoPortal,
  salvarAcessoPortal,
  ultimaLeituraPortal,
} from "@/lib/portal-copadubo";
import { cpfPlausivel, limparCpf } from "@/lib/portal-copadubo-parse";

export const dynamic = "force-dynamic";
/** Um login no portal pode levar alguns segundos; o padrão de 10 s é curto. */
export const maxDuration = 45;
const CAB = { "Cache-Control": "private, no-store" };

/** Freio simples por motorista: 6 leituras manuais por hora (cada uma é 1 login). */
const leituras = new Map<number, number[]>();
function podeLer(id: number) {
  const agora = Date.now();
  const lista = (leituras.get(id) ?? []).filter((t) => agora - t < 3_600_000);
  if (lista.length >= 6) return false;
  lista.push(agora);
  leituras.set(id, lista);
  return true;
}

/** GET → o que este motorista já cadastrou + o resumo da última leitura. */
export async function GET() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const acesso = await acessoPortalDoMotorista(m.id);
  const leitura = acesso ? await ultimaLeituraPortal(m.id) : null;
  return NextResponse.json(acessoPublico(acesso, leitura), { headers: CAB });
}

/**
 * POST { cpf, senha } → guarda as credenciais do portal DO PRÓPRIO motorista
 * (cifradas) e faz a primeira leitura, para ele saber na hora se o login vale.
 *
 * Nada volta para o navegador além do CPF mascarado e do resumo da página.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();

  const corpo = await req.json().catch(() => ({}));
  const cpf = limparCpf(corpo?.cpf);
  const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  // Dica de quem está digitando o CPF errado: 11 números, sem máscara repetida.
  if (!cpfPlausivel(cpf)) {
    return NextResponse.json({ erro: "Digite o CPF completo (11 números)." }, { status: 400, headers: CAB });
  }
  if (senha.trim().length < 3) {
    return NextResponse.json({ erro: "Digite a senha do portal." }, { status: 400, headers: CAB });
  }
  if (!podeLer(m.id)) {
    return NextResponse.json(
      { erro: "Você já testou o portal várias vezes nesta hora. Tente de novo mais tarde." },
      { status: 429, headers: CAB },
    );
  }

  await salvarAcessoPortal(m.id, { cpf, senha });
  let leitura: Awaited<ReturnType<typeof monitorarMotorista>> | null = null;
  try {
    leitura = await monitorarMotorista(m.id, { avisar: false });
  } catch (e) {
    console.error("[portal] primeira leitura falhou:", e instanceof Error ? e.message : e);
  }

  const acesso = await acessoPortalDoMotorista(m.id);
  const ultima = await ultimaLeituraPortal(m.id);
  return NextResponse.json(
    {
      salvo: true,
      ...acessoPublico(acesso, ultima),
      // Mensagem pronta para a tela (sem nenhum dado sensível).
      mensagem: leitura?.loginRecusado
        ? "Guardei seus dados, mas o portal recusou o CPF/senha. Confira e cadastre de novo."
        : leitura?.captcha
          ? "Guardei seus dados. O portal pediu captcha neste acesso — vou continuar tentando."
          : leitura?.ok
            ? "Pronto! O portal abriu com os seus dados e eu já li o que aparece nele."
            : "Guardei seus dados. A primeira leitura não veio completa — vou tentar de novo em instantes.",
    },
    { headers: CAB },
  );
}

/** DELETE → apaga CPF, senha e histórico de leituras deste motorista. */
export async function DELETE() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const removido = await removerAcessoPortal(m.id);
  return NextResponse.json({ removido }, { headers: CAB });
}

/** PUT → lê o portal agora (botão "Ler agora"), sem esperar o ciclo do servidor. */
export async function PUT() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const acesso = await acessoPortalDoMotorista(m.id);
  if (!acesso) {
    return NextResponse.json({ erro: "Cadastre o CPF e a senha do portal primeiro." }, { status: 404, headers: CAB });
  }
  if (!podeLer(m.id)) {
    return NextResponse.json(
      { erro: "Você já testou o portal várias vezes nesta hora. Tente de novo mais tarde." },
      { status: 429, headers: CAB },
    );
  }
  const r = await monitorarMotorista(m.id, { avisar: false });
  const ultima = await ultimaLeituraPortal(m.id);
  return NextResponse.json({ ...r, estado: acessoPublico(acesso, ultima) }, { headers: CAB });
}
