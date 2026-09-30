/**
 * Texto e imagem usados no botão "Compartilhar" e na prévia do link
 * (WhatsApp, Telegram, Facebook...). Ajuste aqui se quiser mudar a mensagem.
 */

export const NOME_APP = "Monitor Ponto CopaLinks";

export const IMAGEM_COMPARTILHAR = "/images/compartilhar.jpg";

/** Descrição curta: aparece embaixo do título na prévia do link. */
export const DESCRICAO_CURTA =
  "Acompanha a fila de ponto da Copadubo a cada 5 segundos e avisa no celular quando o seu número for chamado. Também traz o tempo no porto, frete e contatos.";

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

/** Mensagem completa enviada junto com a imagem e o link. */
export function mensagemCompartilhar(link: string) {
  return [
    `🚛 *${NOME_APP}*`,
    "",
    "Acompanhe seu ponto na fila da Copadubo sem ficar atualizando o site:",
    "✅ Lê o quadro de pontos a cada 5 segundos",
    "🔔 Avisa no celular quando o seu número for chamado",
    "📍 Mostra sua posição na fila e quantos estão na frente",
    "🌦️ Previsão do tempo no porto de Paranaguá (APPA)",
    "🧮 Cálculo de frete pela foto do ticket",
    "📞 Contatos operacionais direto no WhatsApp",
    "",
    `Abra e instale no celular: ${link}`,
  ].join("\n");
}
