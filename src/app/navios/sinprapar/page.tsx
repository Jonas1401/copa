import type { Metadata } from "next";
import EspelhoNaviosApp from "@/components/espelho/EspelhoNaviosApp";
import { painelReferencia } from "@/lib/espelho-navios";

export const metadata: Metadata = {
  title: "COPALINKS — Manobras Previstas SINPRAPAR",
  description:
    "Manobras previstas apenas de navios de fertilizantes: código, berço, data, hora e situação. Cópia do painel COPALINKS dentro do CopaLinks.",
};

/** Cópia idêntica de https://berth-buddy-bot.lovable.app/sinprapar. */
export default function NaviosSinpraparPage() {
  return <EspelhoNaviosApp vista="manobras" inicial={painelReferencia()} />;
}
