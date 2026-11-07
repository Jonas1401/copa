import Image from "next/image";

/**
 * "Quem usa o app": o desenho do motorista (o mesmo enviado pelo Jonas) junto
 * do total de usuários, ao lado do menu ⋮ no canto superior esquerdo.
 *
 * Pedido do Jonas: o capacete sai de cena e entra esta arte — um motorista de
 * boné, de braços cruzados — com o número de usuários logo ao lado. O número
 * tem o MESMO tamanho do ícone de três pontinhos do menu (`size={17}` no
 * `MenuConta`), como pedido: discreto, do tamanho de um ícone, sem virar um
 * balão chamativo.
 *
 * A contagem também continua no cartão e no distintivo da aba "Sobre"; aqui ela
 * aparece desenhada E no rótulo acessível (leitor de tela e toque longo).
 *
 * Cores: só a paleta Dark Navy (tema-dark-navy.test.ts) — a arte é branca (a
 * própria imagem) e o número usa o amarelo de atenção via token `text-ambar`.
 * A sombra é o fundo de cartão, para o desenho continuar legível quando o
 * motorista troca o topo por uma foto clara.
 */
export default function IconeUsuarios({ total }: { total: number | null }) {
  const rotulo =
    total === null
      ? "Contando os usuários do aplicativo"
      : `${total} ${total === 1 ? "usuário" : "usuários"} no CopaLinks`;

  // Mesma abreviação do distintivo do rodapé: números grandes não esticam o topo.
  const contagem =
    total === null ? "—" : total > 99 ? "99+" : String(total);

  return (
    <span
      role="img"
      aria-label={rotulo}
      title={rotulo}
      className="flex h-11 shrink-0 items-center gap-1.5 sm:h-12"
    >
      <Image
        src="/images/inicio/motorista-icone.png"
        alt=""
        aria-hidden="true"
        width={83}
        height={96}
        preload
        className="h-[32px] w-auto drop-shadow-[0_1px_2px_rgba(7,26,40,0.9)] sm:h-[36px]"
      />
      {/* número no tamanho do ícone ⋮ (17 px) */}
      <span
        aria-hidden="true"
        className="tabular font-display text-[17px] leading-none font-bold text-ambar drop-shadow-[0_1px_2px_rgba(7,26,40,0.9)]"
      >
        {contagem}
      </span>
    </span>
  );
}
