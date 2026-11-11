import type { Metadata } from "next";
import ConsultaPontoApp from "@/components/consulta/ConsultaPontoApp";

export const metadata: Metadata = {
  title: "Saldo de Ganhos · Viagens da semana · CopaLinks",
  description:
    "As viagens da semana do seu ponto, lidas no Ticket do Portal do Motorista: quantas viagens, o valor bruto e a sua comissão.",
};

export default function ConsultaPontoPage() {
  return <ConsultaPontoApp />;
}
