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

export const LINK_OFICIAL_APP = "https://copa-links.vercel.app/";

export const IMAGEM_COMPARTILHAR = "/images/compartilhar.jpg?v=2";

/** Imagem usada na página de divulgação (cartão de link e status do WhatsApp). */
export const IMAGEM_DIVULGACAO = "/images/divulgacao-card.jpg?v=2";
export const IMAGEM_STATUS = "/images/divulgacao-status.jpg?v=2";

/** Descrição curta: aparece embaixo do título na prévia do link. */
export const DESCRICAO_CURTA =
  "Um aplicativo desenvolvido para facilitar o dia a dia dos motoristas no Porto de Paranaguá: monitoramento dos pontos da Copadubo, alertas, tempo, frete, assistente mecânico com IA, contatos, chat e navios de fertilizantes.";

/** Cabeçalho da mensagem. */
export const CABECALHO_PROMO = "Conheça o CopaLinks!";

/** Chamada (segunda linha da mensagem e subtítulo da página de divulgação). */
export const TITULO_PROMO =
  "Um aplicativo desenvolvido para facilitar o dia a dia dos motoristas no Porto de Paranaguá.";

/** Fecho da mensagem: o app inteiro em uma frase. */
export const FECHO_PROMO =
  "Tudo isso em um só aplicativo, gratuito e pensado para quem vive a rotina do porto!";

/** Rótulo em negrito antes do endereço na mensagem. */
export const CHAMADA_LINK_PROMO = "Acesse e conheça:";

/** Assinatura no fim da mensagem. */
export const ASSINATURA_PROMO = "CopaLinks — Conectar • Facilitar • Evoluir.";

/** Os oito recursos do app (emoji + título na mensagem + descrição na página de divulgação). */
export const BENEFICIOS = [
  {
    emoji: "📍",
    titulo: "Monitoramento dos pontos da Copadubo",
    texto: "Acompanha os quadros oficiais a cada 5 segundos e mostra sua posição na fila.",
  },
  {
    emoji: "🔔",
    titulo: "Alertas de chamadas",
    texto: "Receba notificações no celular assim que o seu número for chamado.",
  },
  {
    emoji: "🌦️",
    titulo: "Previsão do tempo",
    texto: "Acompanhe o clima, marés e condições no Porto de Paranaguá.",
  },
  {
    emoji: "🧮",
    titulo: "Cálculo de frete",
    texto: "Envie uma foto do ticket e facilite suas contas na hora.",
  },
  {
    emoji: "🔧",
    titulo: "Assistente mecânico inteligente com IA",
    texto: "Tire dúvidas mecânicas e envie fotos do painel ou de peças com inteligência artificial.",
  },
  {
    emoji: "📲",
    titulo: "Contatos e informações úteis",
    texto: "Acesso rápido aos telefones e canais operacionais pelo WhatsApp.",
  },
  {
    emoji: "💬",
    titulo: "Chat para compartilhar informações com outros motoristas",
    texto: "Converse em tempo real, mande áudios e troque avisos da rotina do porto.",
  },
  {
    emoji: "🚢",
    titulo: "Informações sobre a atracação dos navios de fertilizantes",
    texto: "Acompanhe navios atracados, saldo, manobras previstas e programação dos berços.",
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

/** Garante barra final quando o link é apenas a raiz do domínio. */
export function normalizarLinkCompartilhar(link: string) {
  const limpo = link.trim() || LINK_OFICIAL_APP;
  return /^https?:\/\/[^/?#]+$/i.test(limpo) ? `${limpo}/` : limpo;
}

/**
 * A mensagem de divulgação, linha a linha.
 */
export function linhasDaMensagem(link: string): Linha[] {
  const endereco = normalizarLinkCompartilhar(link);
  return [
    [{ texto: "🚛💙 ", negrito: false }, { texto: CABECALHO_PROMO, negrito: true }],
    [],
    [{ texto: TITULO_PROMO, negrito: false }],
    [],
    ...BENEFICIOS.map((b): Linha => [{ texto: `${b.emoji} ${b.titulo}`, negrito: false }]),
    [],
    [{ texto: FECHO_PROMO, negrito: false }],
    [],
    [
      { texto: "🔗 ", negrito: false },
      { texto: CHAMADA_LINK_PROMO, negrito: true },
    ],
    [{ texto: endereco, negrito: false }],
    [],
    [
      { texto: "💙 ", negrito: false },
      { texto: ASSINATURA_PROMO, negrito: true },
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
  return typeof window !== "undefined" ? window.location.origin : LINK_OFICIAL_APP;
}

/** Link de compartilhamento no WhatsApp com a mensagem já preenchida. */
export function linkWhatsAppMensagem(mensagem: string) {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
}

/* ------------------------------------------- compartilhamento com imagem */

let promessaArquivo: Promise<File | null> | null = null;

/**
 * Pré-carrega em memória a imagem Dark Navy do app (`IMAGEM_COMPARTILHAR`)
 * para que o toque no ícone de compartilhar dispare `navigator.share` na hora,
 * sem perder o gesto do usuário em conexões móveis lentas.
 */
export function carregarArquivoCompartilhar(): Promise<File | null> {
  if (typeof window === "undefined" || typeof File === "undefined") {
    return Promise.resolve(null);
  }
  if (!promessaArquivo) {
    promessaArquivo = fetch(IMAGEM_COMPARTILHAR)
      .then(async (r) => {
        if (!r.ok) return null;
        const blob = await r.blob();
        return new File([blob], "copalinks.jpg", { type: blob.type || "image/jpeg" });
      })
      .catch(() => null)
      .then((arq) => {
        if (!arq) promessaArquivo = null;
        return arq;
      });
  }
  return promessaArquivo;
}

export type ResultadoCompartilhar = "compartilhou" | "copiou" | "cancelou" | "link";

/**
 * Compartilha a imagem do aplicativo (tema Dark Navy) junto com a mensagem
 * completa. Se o aparelho não suportar envio de arquivo, envia a mensagem com
 * o link; sem `navigator.share`, copia a mensagem para a área de transferência.
 */
export async function compartilharAplicativo(
  link = linkDoApp(),
): Promise<ResultadoCompartilhar> {
  const texto = mensagemCompartilhar(link);
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      const arquivo = await carregarArquivoCompartilhar();
      if (arquivo && (!navigator.canShare || navigator.canShare({ files: [arquivo] }))) {
        try {
          await navigator.share({ files: [arquivo], title: NOME_APP, text: texto });
          return "compartilhou";
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return "cancelou";
          // Alguns navegadores anunciam suporte a arquivos mas falham no envio:
          // segue para o compartilhamento da mensagem em texto.
        }
      }
      await navigator.share({ title: NOME_APP, text: texto });
      return "compartilhou";
    }
    await navigator.clipboard.writeText(texto);
    return "copiou";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelou";
    try {
      await navigator.clipboard.writeText(texto);
      return "copiou";
    } catch {
      return "link";
    }
  }
}
