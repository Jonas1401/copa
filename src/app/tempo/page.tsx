import type { Metadata } from "next";
import TempoApp from "@/components/tempo/TempoApp";
import { obterPrevisao, type Previsao } from "@/lib/tempo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tempo em Paranaguá · CopaLinks",
  description: "Previsão do tempo do porto de Paranaguá com os dados da APPA (SIMPORT).",
};

export default async function TempoPage() {
  // Com o cache quente a previsão vem na hora; se a APPA demorar, a página
  // abre assim mesmo e a tela busca sozinha.
  const inicial = await Promise.race<Previsao | null>([
    obterPrevisao().catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 2500)),
  ]);
  return <TempoApp inicial={inicial} />;
}
