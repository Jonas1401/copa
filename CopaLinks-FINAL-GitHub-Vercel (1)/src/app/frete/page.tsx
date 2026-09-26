import type { Metadata } from "next";
import FreteApp from "@/components/frete/FreteApp";

export const metadata: Metadata = {
  title: "Frete Fácil · Calculadora do Motorista · CopaLinks",
  description:
    "Envie a foto do ticket: o app soma Quant × Valor de cada carga e mostra quanto o motorista vai receber.",
};

export default function FretePage() {
  return <FreteApp />;
}
