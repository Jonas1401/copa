import Link from "next/link";
import MonitorApp from "@/components/MonitorApp";
import { garantirSemente, montarEstado } from "@/lib/estado";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    await garantirSemente();
    const inicial = await montarEstado();
    // Sem rede e sem escrita aqui: a página pinta na hora. A varredura do site
    // roda no ciclo de 5s do cliente (e no cadastro de cada ponto).
    return <MonitorApp inicial={inicial} />;
  } catch {
    // Banco ainda não conectado neste ambiente (ex.: deploy novo na Vercel
    // antes de criar o Postgres). Mostra uma tela de espera amigável.
    return <AguardandoBanco />;
  }
}

function AguardandoBanco() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050f28] px-4">
      <div className="w-full max-w-[420px] rounded-[28px] border border-[#2a5bb0]/60 bg-[#0a1d45]/90 p-7 text-center">
        <img
          src="/icons/copalinks-192.png"
          alt="CopaLinks"
          className="mx-auto h-20 w-20 rounded-[22px] shadow-[0_0_40px_-10px_rgba(30,136,240,0.7)]"
        />
        <h1 className="mt-4 font-display text-[24px] font-extrabold text-white">
          CopaLinks
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gelo/80">
          O aplicativo está publicado. Falta apenas conectar o banco de dados
          PostgreSQL neste projeto da Vercel.
        </p>
        <ol className="mt-4 space-y-2 rounded-[16px] border border-[#2a5bb0]/50 bg-[#06122b]/70 p-4 text-left text-[14px] text-gelo/85">
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
          className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#ffd84d,#e9a400)] px-6 font-display text-[15px] font-extrabold text-[#2a1a00]"
        >
          Já conectei — atualizar
        </Link>
      </div>
    </main>
  );
}
