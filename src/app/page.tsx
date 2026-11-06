import Link from "next/link";
import MonitorApp from "@/components/MonitorApp";
import { temBancoConfigurado } from "@/db";
import {
  estadoInicialOffline,
  garantirSemente,
  montarEstado,
  type EstadoDTO,
} from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import { LOGO } from "@/lib/logo";

export const dynamic = "force-dynamic";

/**
 * Teto da leitura inicial no servidor (bem abaixo do limite de 10 s da Vercel
 * Hobby): mesmo se o banco demorar a acordar, o link do app abre na hora e o
 * navegador sincroniza os dados pelo ciclo de 5 s de /api/estado.
 */
const PRAZO_ABERTURA_MS = 3_500;

function erroEsquemaAusente(erro: unknown): boolean {
  const codigo =
    typeof erro === "object" && erro !== null && "code" in erro
      ? String((erro as { code?: unknown }).code)
      : "";
  const msg = erro instanceof Error ? erro.message : String(erro);
  const causa =
    erro instanceof Error && erro.cause instanceof Error ? erro.cause.message : "";
  return (
    codigo === "42P01" ||
    codigo === "42703" ||
    /does not exist|não existe/i.test(`${msg} ${causa}`)
  );
}

async function carregarEstadoInicial(): Promise<EstadoDTO> {
  try {
    const motorista = await motoristaDaSessao();
    return await montarEstado(motorista?.id ?? null);
  } catch (erro) {
    if (!erroEsquemaAusente(erro)) throw erro;
    // Primeiro acesso de um banco recém-criado: prepara as tabelas e semeia.
    await garantirSemente();
    const motorista = await motoristaDaSessao();
    return await montarEstado(motorista?.id ?? null);
  }
}

function comPrazo<T>(tarefa: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limite = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return Promise.race([tarefa, limite]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export default async function Home() {
  if (!temBancoConfigurado) {
    // Banco ainda não configurado nas variáveis do ambiente: mostra o passo a passo.
    return <AguardandoBanco />;
  }

  let inicial: EstadoDTO;
  try {
    const lido = await comPrazo(carregarEstadoInicial(), PRAZO_ABERTURA_MS);
    inicial = lido ?? estadoInicialOffline();
  } catch (erro) {
    console.error("[home] abertura em contingência após falha temporária do banco:", erro);
    inicial = estadoInicialOffline();
  }
  // Sem rede externa aqui: a página pinta na hora. A varredura do site roda
  // no ciclo de 5s do cliente (e no cadastro de cada ponto).
  return <MonitorApp inicial={inicial} />;
}

function AguardandoBanco() {
  return (
    <main className="fundo-app flex min-h-screen items-center justify-center bg-fundo px-4">
      <div className="largura-aparelho rounded-[28px] border border-[#183341]/60 bg-[#071A28]/90 p-7 text-center">
        <img
          src={LOGO.src}
          alt="CopaLinks"
          width={LOGO.largura}
          height={LOGO.altura}
          className="mx-auto h-auto w-[220px]"
        />
        <h1 className="mt-4 font-display text-[24px] font-extrabold text-white">
          CopaLinks
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gelo/80">
          O aplicativo está publicado. Falta apenas conectar o banco de dados
          PostgreSQL neste projeto da Vercel.
        </p>
        <ol className="mt-4 space-y-2 rounded-[16px] border border-[#183341]/50 bg-[#071A28]/70 p-4 text-left text-[14px] text-gelo/85">
          <li>
            1. Na Vercel, abra este projeto e vá em{" "}
            <b className="text-white">Storage → Create → Postgres</b>.
          </li>
          <li>
            2. Escolha a região <b className="text-white">São Paulo (gru1)</b> e
            conecte ao projeto <b className="text-white">copa-links</b>.
          </li>
          <li>3. Volte aqui e atualize esta página.</li>
        </ol>
        <p className="mt-3 text-[13px] text-gelo/60">
          Depois disso o app funciona para sempre neste endereço.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-full bg-ambar px-6 font-display text-[15px] font-extrabold text-[#000D16]"
        >
          Já conectei — atualizar
        </Link>
      </div>
    </main>
  );
}
