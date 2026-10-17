/**
 * Texto e imagem usados no botão "Compartilhar" e na prévia do link
 * (WhatsApp, Telegram, Facebook...). Ajuste aqui se quiser mudar a mensagem.
 *
 * A mensagem é montada em BLOCOS (linhas com trechos em negrito) para que o
 * mesmo texto apareça igual no WhatsApp e na página de divulgação
 * (/divulgacao): no WhatsApp o negrito sai com `*`, na página ele vira
 * <b>. Assim o texto que o motorista manda no grupo nunca diverge do que a
 * página promete.
 */

export const NOME_APP = "Monitor Ponto CopaLinks";

export const IMAGEM_COMPARTILHAR = "/images/compartilhar.jpg";

/** Imagem usada na página de divulgação (cartão de link e status do WhatsApp). */
export const IMAGEM_DIVULGACAO = "/images/divulgacao-card.jpg";
export const IMAGEM_STATUS = "/images/divulgacao-status.jpg";

/** Descrição curta: aparece embaixo do título na prévia do link. */
export const DESCRICAO_CURTA =
  "Acompanha a fila de ponto da Copadubo a cada 5 segundos e avisa no celular quando o seu número for chamado. Também traz o tempo no porto, frete, assistente IA, chat e contatos.";

/** Chamada (segunda linha da mensagem e título da página de divulgação). */
export const TITULO_PROMO =
  "Mais praticidade e tecnologia para o dia a dia do motorista!";

/** Fecho da mensagem: o app inteiro em uma frase. */
export const FECHO_PROMO =
  "Tudo isso em um só aplicativo, feito para facilitar a vida de quem vive na estrada e no porto!";

/** Assinatura no fim da mensagem. */
export const ASSINATURA_PROMO = "COPALINKS — Desenvolver • Conectar • Evoluir";

/** Cabeçalho da mensagem. */
export const CABECALHO_PROMO = "COPALINKS — SEU PARCEIRO NO PORTO!";

/** Os oito recursos do app (emoji + título + texto). */
export const BENEFICIOS = [
  {
    emoji: "✅",
    titulo: "Monitoramento automático",
    texto: "acompanha os pontos da Copadubo a cada 5 segundos.",
  },
  {
    emoji: "🔔",
    titulo: "Alertas",
    texto: "receba notificações quando seu número for chamado.",
  },
  {
    emoji: "📍",
    titulo: "Fila em tempo real",
    texto: "veja sua posição e quantos estão na frente.",
  },
  {
    emoji: "🌦️",
    titulo: "Previsão do tempo",
    texto: "acompanhe o clima no Porto de Paranaguá.",
  },
  {
    emoji: "🧮",
    titulo: "Cálculo de frete",
    texto: "envie uma foto do ticket e facilite suas contas.",
  },
  {
    emoji: "🤖",
    titulo: "Assistente IA",
    texto: "tire dúvidas, envie fotos e crie imagens com inteligência artificial!",
  },
  {
    emoji: "💬",
    titulo: "Chat CopaLinks",
    texto: "converse e troque informações com outros motoristas.",
  },
  {
    emoji: "📞",
    titulo: "Contatos operacionais",
    texto: "acesso rápido pelo WhatsApp.",
  },
] as const;

/** Os três passos para começar (usados na página de divulgação). */
export const PASSOS = [
  {
    numero: "1",
    titulo: "Cadastre o seu ponto",
    texto: "Tipo (TRUCK ou CAVALO/C), livro (A, B ou M) e número. Leva poucos segundos.",
  },
  {
    numero: "2",
    titulo: "Acompanhe a fila",
    texto: "O app lê o quadro oficial a cada 5 segundos e mostra a sua posição e quantos estão na frente.",
  },
  {
    numero: "3",
    titulo: "Receba o aviso",
    texto: "Quando o seu número é chamado, o celular apita — mesmo com o app fechado.",
  },
] as const;

/* ------------------------------------------------------- texto em blocos */

/** Trecho de uma linha da mensagem. */
export type Trecho = { texto: string; negrito?: boolean };

/** Linha da mensagem: vários trechos emendados (sem separador). */
export type Linha = Trecho[];

/**
 * A mensagem de divulgação, linha a linha. O link do app entra no lugar de
 * `{{link}}` — é o endereço que o navegador está usando (domínio fixo na
 * Vercel, localhost em desenvolvimento).
 */
export function linhasDaMensagem(link: string): Linha[] {
  return [
    [{ texto: "🚛💙 ", negrito: false }, { texto: CABECALHO_PROMO, negrito: true }],
    [],
    [{ texto: "📲 ", negrito: false }, { texto: TITULO_PROMO, negrito: false }],
    [],
    ...BENEFICIOS.map((b): Linha => [
      { texto: `${b.emoji} `, negrito: false },
      { texto: `${b.titulo}:`, negrito: true },
      { texto: ` ${b.texto}`, negrito: false },
    ]),
    [],
    [{ texto: "🚀 ", negrito: false }, { texto: FECHO_PROMO, negrito: true }],
    [],
    [
      { texto: "📲 ", negrito: false },
      { texto: "Acesse e instale gratuitamente:", negrito: true },
      { texto: ` 🔗 ${link}`, negrito: false },
    ],
    [],
    [
      { texto: "💙 ", negrito: false },
      { texto: ASSINATURA_PROMO, negrito: true },
      { texto: " 🚛", negrito: false },
    ],
  ];
}

/** A mensagem como texto (para o WhatsApp, a área de transferência, etc.). */
export function mensagemCompartilhar(link: string) {
  return linhasDaMensagem(link)
    .map((linha) =>
      linha.map((t) => (t.negrito ? `*${t.texto}*` : t.texto)).join(""),
    )
    .join("\n");
}

/**
 * Endereço do app para compartilhar: o domínio fixo (gravado na página como
 * endereço canônico); se não houver, o endereço que o navegador está usando.
 */
export function linkDoApp() {
  if (typeof document !== "undefined") {
    const c = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (c?.href) return c.href;
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}

/** Link de compartilhamento no WhatsApp com a mensagem já preenchida. */
export function linkWhatsAppMensagem(mensagem: string) {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
}
