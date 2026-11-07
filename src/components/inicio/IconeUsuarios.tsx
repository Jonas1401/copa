/**
 * Ícone "quem usa o app": só o capacete de segurança, ao lado do menu ⋮ no
 * canto superior esquerdo.
 *
 * Pedido do Jonas: tirar o balão com o número e deixar apenas um capacete
 * bem desenhado. O desenho agora é um capacete de obra de verdade — domo
 * largo e baixo, crista central descendo até a aba e aba saliente dos dois
 * lados — no mesmo traço dos outros controles do topo (compartilhar, clima).
 *
 * A contagem NÃO sumiu do app: continua no cartão e no distintivo da aba
 * "Sobre". Aqui ela fica só no rótulo acessível (leitor de tela e toque
 * longo), sem desenhar número nenhum na tela.
 *
 * Cores: só a paleta Dark Navy (tema-dark-navy.test.ts) — o traço é o amarelo
 * de segurança via token `text-ambar`, a cor de capacete de obra e a mesma
 * do botão do Chat. A sombra é o fundo de cartão, para o capacete continuar
 * legível quando o motorista troca o topo por uma foto clara.
 */
export default function IconeUsuarios({ total }: { total: number | null }) {
  const rotulo =
    total === null
      ? "Contando os usuários do aplicativo"
      : `${total} ${total === 1 ? "usuário" : "usuários"} no CopaLinks`;

  return (
    <span
      role="img"
      aria-label={rotulo}
      title={rotulo}
      className="grid h-11 w-11 shrink-0 place-items-center text-ambar sm:h-12 sm:w-12"
    >
      <svg
        viewBox="0 0 44 30"
        aria-hidden="true"
        className="h-[21px] w-[30px] drop-shadow-[0_1px_2px_rgba(7,26,40,0.9)] sm:h-[22px] sm:w-[32px]"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* casco: domo largo e baixo, assentado na aba */}
          <path d="M7.6 21.4v-2.2C7.6 11.3 14 4.9 22 4.9s14.4 6.4 14.4 14.3v2.2" />
          {/* crista central: os dois vincos que descem do topo até a aba */}
          <path d="M18.3 21.4V6.4" />
          <path d="M25.7 21.4V6.4" />
          {/* aba saliente dos dois lados, com as pontas arredondadas */}
          <path d="M4.6 21.4h34.8a3.1 3.1 0 0 1 0 6.2H4.6a3.1 3.1 0 0 1 0-6.2Z" />
        </g>
      </svg>
    </span>
  );
}
