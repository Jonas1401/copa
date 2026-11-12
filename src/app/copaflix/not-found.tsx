import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";

/** Título que saiu do acervo (ou link antigo) não quebra a navegação. */
export default function CopaFlixNaoEncontrado() {
  return (
    <main className="copaflix grid min-h-dvh place-items-center px-4 py-10">
      <div className="cf-halo" aria-hidden />
      <div className="cf-card w-full max-w-[440px] p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ciano/15 text-ciano">
          <Clapperboard size={22} />
        </span>
        <h1 className="mt-3 font-display text-[20px] font-extrabold text-gelo">
          Título não encontrado
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-aco">
          Este título saiu do acervo ou o endereço está incompleto. Volte ao CopaFlix para ver o
          que está disponível agora.
        </p>
        <Link href="/copaflix" className="cf-botao-ouro mt-4">
          <ArrowLeft size={16} /> Ir para o CopaFlix
        </Link>
      </div>
    </main>
  );
}
