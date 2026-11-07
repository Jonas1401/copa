import type { Metadata } from "next";
import EspelhoNaviosApp from "@/components/espelho/EspelhoNaviosApp";
import { painelReferencia } from "@/lib/espelho-navios";

export const metadata: Metadata = {
  title: "COPALINKS — Navios Atracados",
  description:
    "Navios de fertilizantes atracados em Paranaguá e Antonina: berço, operadoras, saldos e descarga. Cópia do painel COPALINKS dentro do CopaLinks.",
};

/**
 * Cópia idêntica da tela inicial de https://berth-buddy-bot.lovable.app/.
 * A página pinta na hora com a última leitura gravada e o cliente busca as
 * duas fontes oficiais (APPA + SINPRAPAR) em /api/navios/espelho.
 */
export default function NaviosAtracadosPage() {
  return <EspelhoNaviosApp vista="atracados" inicial={painelReferencia()} />;
}
