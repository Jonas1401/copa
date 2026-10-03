import type { Metadata } from "next";
import TempoApp from "@/components/tempo/TempoApp";
import { statusRadarClima, type StatusRadarClima } from "@/lib/clima-monitor";
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
  // Situação do radar da previsão (monitoramento constante no servidor).
  const radar = await Promise.race<StatusRadarClima | null>([
    statusRadarClima().catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);
  return <TempoApp inicial={inicial} radar={radar} />;
}
