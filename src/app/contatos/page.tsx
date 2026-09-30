import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Phone } from "lucide-react";
import { CONTATOS, linkWhatsApp } from "@/lib/servicos";
import { FUNDO } from "@/lib/fundo";

export const metadata: Metadata = {
  title: "Contatos Operacionais · Monitor Ponto CopaLinks",
};

function IconeWhatsApp({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01Zm-7.01 15.24h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.230-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.17 1.74 2.65 4.21 3.72.59.25 1.05.4 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

export default function ContatosPage() {
  return (
    <div className="relative min-h-screen w-full bg-abismo">
      <img
        src={FUNDO.src}
        alt=""
        aria-hidden
        className="fixed inset-0 h-full w-full object-cover object-center"
      />
      <div className="fixed inset-0 bg-[linear-gradient(180deg,rgba(4,16,42,0.45)_0%,rgba(3,12,32,0.35)_45%,rgba(2,8,24,0.60)_100%)]" />

      <main className="relative mx-auto w-full max-w-[390px] px-3 pt-4 pb-10">
        <header className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Voltar ao início"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 text-white transition-colors hover:border-ciano/70 hover:text-ciano"
          >
            <ChevronLeft size={26} strokeWidth={2.2} />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(19px,5.6vw,25px)] leading-tight font-extrabold tracking-[0.01em] text-white uppercase">
              Contatos Operacionais
            </h1>
            <p className="text-[14px] text-gelo/80">
              Toque para abrir a conversa no WhatsApp
            </p>
          </div>
        </header>

        <ul className="mt-5 space-y-2.5">
          {CONTATOS.map((c) => (
            <li key={c.nome}>
              <a
                href={linkWhatsApp(c.numero)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-[20px] border-[1.5px] border-[#1d4690]/70 bg-[linear-gradient(180deg,rgba(12,34,80,0.88),rgba(8,24,60,0.92))] px-3.5 py-3 transition-colors hover:border-[#25d366]/70 active:scale-[0.99]"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#e63950] text-white shadow-[0_0_22px_-4px_rgba(230,57,80,0.8)]">
                  <Phone size={21} strokeWidth={2.3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] leading-tight font-extrabold text-white">
                    {c.nome}
                  </span>
                  <span className="tabular mt-0.5 block text-[15px] text-gelo/85">
                    {c.numero}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#25d366] px-3.5 py-2.5 font-display text-[14px] font-extrabold text-[#062b14] shadow-[0_8px_24px_-10px_rgba(37,211,102,0.9)] transition-transform group-hover:scale-[1.03]">
                  <IconeWhatsApp className="h-[18px] w-[18px]" />
                  WhatsApp
                </span>
              </a>
            </li>
          ))}
        </ul>

        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-1.5 font-display text-[14px] font-bold tracking-[0.06em] text-azulclaro uppercase transition-colors hover:text-ciano"
        >
          <ChevronLeft size={18} strokeWidth={2.6} /> Voltar ao início
        </Link>
      </main>
    </div>
  );
}
