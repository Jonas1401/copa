import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./copaflix.css";

export const metadata: Metadata = {
  title: "CopaFlix · Entretenimento do CopaLinks",
  description:
    "Filmes, séries, novelas e TV ao vivo dentro do CopaLinks — com fontes autorizadas, domínio público, Creative Commons e a sua biblioteca Jellyfin.",
};

/**
 * Layout do módulo CopaFlix. O CSS daqui é exclusivo do módulo e importado só
 * nesta rota: o restante do CopaLinks continua com o tema de sempre, sem
 * nenhuma folha de estilo nova carregada nas outras telas.
 */
export default function CopaFlixLayout({ children }: { children: ReactNode }) {
  return children;
}
