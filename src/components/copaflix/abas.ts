import {
  Bookmark,
  CirclePlay,
  Clock,
  Film,
  Heart,
  House,
  Radio,
  Tv,
} from "lucide-react";

export type AbaCopaFlix =
  | "inicio"
  | "filmes"
  | "series"
  | "novelas"
  | "tv"
  | "favoritos"
  | "continuar";

export type ItemAba = {
  id: AbaCopaFlix;
  rotulo: string;
  rotuloCurto: string;
  icone: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

/** Ordem das abas do CopaFlix. */
export const ABAS: ItemAba[] = [
  { id: "inicio", rotulo: "Início", rotuloCurto: "Início", icone: House },
  { id: "filmes", rotulo: "Filmes", rotuloCurto: "Filmes", icone: Film },
  { id: "series", rotulo: "Séries", rotuloCurto: "Séries", icone: Tv },
  { id: "novelas", rotulo: "Novelas", rotuloCurto: "Novelas", icone: Heart },
  { id: "tv", rotulo: "TV ao vivo", rotuloCurto: "TV", icone: Radio },
  { id: "favoritos", rotulo: "Favoritos", rotuloCurto: "Favoritos", icone: Bookmark },
  { id: "continuar", rotulo: "Continuar assistindo", rotuloCurto: "Continuar", icone: CirclePlay },
];

/** Abas do rodapé no celular (o "Continuar" fica no atalho da tela inicial). */
export const ABAS_RODAPE: AbaCopaFlix[] = [
  "inicio",
  "filmes",
  "series",
  "novelas",
  "tv",
  "favoritos",
];

/** Ícone usado na seção "Continuar assistindo" quando preciso solto. */
export const ICONE_CONTINUAR = Clock;

export function abaPorId(id: string): AbaCopaFlix {
  return ABAS.some((a) => a.id === id) ? (id as AbaCopaFlix) : "inicio";
}
