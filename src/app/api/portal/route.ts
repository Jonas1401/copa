import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import {
  acessoPortalDoMotorista,
  acessoPublico,
  garantirTabelasPortal,
  removerAcessoPortal,
  salvarAcessoPortal,
  ultimaLeituraPortal,
} from "@/lib/portal-copadubo";
import { cpfPlausivel, limparCpf } from "@/lib/portal-copadubo-parse";
import { monitorarMotorista } from "@/lib/portal-monitor";
import { fontePortal, intervaloStatusMs, situacaoFresca, situacoesDoMotorista } from "@/lib/portal-situacao";

export const dynamic = "force-dynamic";
/** Um login no portal pode levar alguns segundos; o padrão de 10 s é curto. */
export const maxDuration = 45;
const CAB = { "Cache-Control": "private, no-store" };

/** Freio simples por motorista: 6 leituras manuais por hora (uma leitura manual pode ser 1 login). */
const leituras = new Map<number, number[]>();
function podeLer(id: number) {
  const agora = Date.now();
  const lista = (leituras.get(id) ?? []).filter((t) => agora - t < 3_600_000);
  if (lista.length >= 6) return false;
  lista.push(agora);
  leituras.set(id, lista);
  return true;
}

/**
 * Como o ponto deste motorista está sendo monitorado, para a tela explicar sem
 * adivinhar: quem decide a saída (o Status do portal ou o quadro), de quanto em
 * quanto tempo o Status é olhado e a situação guardada de cada ponto dele.
 */
async function monitoramentoDe(motoristaId: number) {
  const fonte = fontePortal();
  if (fonte !== "portal") return { fonte, intervaloMin: null, situacoes: [] };
  const situacoes = await situacoesDoMotorista(motoristaId).catch(() => []);
  return {
    fonte,
    intervaloMin: Math.round(intervaloStatusMs() / 60_000),
    situacoes: situacoes
      .map((s) => ({
        codigo: s.codigo,
        turno: s.turno,
        lidoEm: s.lidoEm.toISOString(),
        mudouEm: s.mudouEm.toISOString(),
        // Leitura antiga não afirma nada sobre agora.
        recente: situacaoFresca(s),
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
  };
}

/** O que a tela do motorista mostra: cadastro, última leitura e monitoramento. */
async function estadoDaTela(motoristaId: number) {
  const acesso = await acessoPortalDoMotorista(motoristaId);
  const leitura = acesso ? await ultimaLeituraPortal(motoristaId) : null;
  return { ...acessoPublico(acesso, leitura), ...(await monitoramentoDe(motoristaId)) };
}

/** GET → o que este motorista já cadastrou + o resumo da última leitura. */
export async function GET() {
  await garantirTabelas();
  await garantirTabelasPortal();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  return NextResponse.json(await estadoDaTela(m.id), { headers: CAB });
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

  // O portal abriu com a conta dele, mas a tela de Status não mostrou a
  // situação de nenhum ponto cadastrado no app: sem ela não há aviso de saída.
  const semSituacao = Boolean(leitura && "entrou" in leitura && leitura.entrou && !leitura.ok);
  // Situação de cada ponto lida agora: o motorista confere na hora se o app
  // enxerga o ponto dele (é a troca dela que gera o aviso de saída).
  const lidas =
    leitura && "situacoes" in leitura && Array.isArray(leitura.situacoes)
      ? leitura.situacoes.filter((x) => x.turno).map((x) => `${x.codigo} ${x.turno}`)
      : [];
  return NextResponse.json(
    {
      salvo: true,
      ...(await estadoDaTela(m.id)),
      // Mensagem pronta para a tela (sem nenhum dado sensível).
      mensagem: leitura?.loginRecusado
        ? "Guardei seus dados, mas o portal recusou o CPF/senha. Confira e cadastre de novo."
        : leitura?.captcha
          ? "Guardei seus dados, mas o portal pediu captcha neste acesso — a leitura automática não passa por ele."
          : leitura?.ok
            ? lidas.length
              ? `Pronto! O portal abriu com os seus dados. Status lido agora: ${lidas.join(" · ")}. Daqui em diante eu aviso quando ele mudar.`
              : "Pronto! O portal abriu com os seus dados e eu já li o que aparece nele."
            : semSituacao
              ? "O portal abriu com os seus dados, mas a tela de Status não mostrou a situação do ponto cadastrado no app (ATIVO / ESCALADO / EM DISPENSA). Confira se o número do ponto no app é o mesmo da sua conta no portal; o que foi lido aparece em “Última leitura”."
              : "Guardei seus dados, mas a primeira leitura não veio completa. Toque em “Ler agora” para tentar de novo; o motivo aparece em “Última leitura”.",
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
  if (acesso.ativo !== 1) {
    // Pausado depois de duas recusas seguidas: insistir com a mesma senha
    // poderia bloquear a conta do motorista no portal.
    return NextResponse.json(
      { erro: "A leitura está pausada porque o portal recusou o CPF/senha. Toque em “Trocar CPF/senha” e cadastre de novo." },
      { status: 409, headers: CAB },
    );
  }
  if (!podeLer(m.id)) {
    return NextResponse.json(
      { erro: "Você já testou o portal várias vezes nesta hora. Tente de novo mais tarde." },
      { status: 429, headers: CAB },
    );
  }
  const r = await monitorarMotorista(m.id, { avisar: false });
  // O acesso é relido: esta leitura pode ter sido a segunda recusa (pausa).
  return NextResponse.json({ ...r, estado: await estadoDaTela(m.id) }, { headers: CAB });
}
