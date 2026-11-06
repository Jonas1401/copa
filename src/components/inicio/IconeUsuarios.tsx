/**
 * Ícone "quem usa o app": cabeça com capacete + distintivo com o total de
 * motoristas cadastrados no CopaLinks (o mesmo número do `/api/motoristas`).
 *
 * Pedido do Jonas: um desenho no estilo da arte enviada (cabeça de capacete +
 * "balão" com o número), ao lado do menu ⋮ no canto superior esquerdo. O
 * distintivo é dinâmico — cresce/encolhe a fonte conforme a contagem — e usa
 * só as cores da paleta Dark Navy (tema-dark-navy.test.ts).
 */
export default function IconeUsuarios({ total }: { total: number | null }) {
  const rotulo =
    total === null
      ? "Contando os usuários do aplicativo"
      : `${total} ${total === 1 ? "usuário" : "usuários"} no CopaLinks`;
  const texto = total === null ? "…" : total > 999 ? "999+" : String(total);
  const fonte = texto.length <= 2 ? 13 : texto.length === 3 ? 10 : 8.2;

  return (
    <span
      role="img"
      aria-label={rotulo}
      title={rotulo}
      className="grid h-11 w-11 shrink-0 place-items-center sm:h-12 sm:w-12"
    >
      <svg viewBox="0 0 64 64" aria-hidden="true" className="h-full w-full overflow-visible">
        {/* cabeça com capacete (contorno claro, como na arte) */}
        <g fill="none" stroke="#EAF4F7" strokeLinecap="round" strokeLinejoin="round">
          {/* nervuras do capacete */}
          <path d="M19.5 7 V29" strokeWidth="3.6" />
          <path d="M13.6 29 C13.5 20.5 15.1 15.7 17.1 13.4" strokeWidth="3" />
          <path d="M25.4 29 C25.5 20.5 23.9 15.7 21.9 13.4" strokeWidth="3" />
          {/* domo */}
          <path d="M8 29 C8 16.5 12.4 11.2 19.5 11.2 C26.6 11.2 31 16.5 31 29" strokeWidth="3" />
          {/* aba do capacete */}
          <path d="M3.5 32 H35.5" strokeWidth="4.4" />
          {/* rosto */}
          <path d="M10 36.5 V42 a9.5 10.75 0 0 0 19 0 V36.5" strokeWidth="3" />
          {/* orelhas */}
          <path d="M10 38 H7.6 M29 38 H31.4" strokeWidth="3" />
        </g>
        {/* distintivo com o total de usuários */}
        <rect x="29" y="3.5" width="31.5" height="22" rx="11" fill="#00B8BC" stroke="#183341" strokeWidth="3.4" />
        <text
          x="44.75"
          y="19.2"
          textAnchor="middle"
          fontFamily="var(--font-display), system-ui, sans-serif"
          fontWeight={800}
          fontSize={fonte}
          letterSpacing="-0.5"
          fill="#000D16"
          className="tabular"
        >
          {texto}
        </text>
      </svg>
    </span>
  );
}
