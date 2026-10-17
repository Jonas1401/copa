/**
 * Endereço público do app (uma fonte de verdade para o layout, para a página
 * de divulgação e para o link canônico).
 *
 * Ordem de prioridade:
 *   1. SITE_URL (domínio fixo, definido no ambiente da Vercel)
 *   2. VERCEL_PROJECT_PRODUCTION_URL (domínio do projeto na Vercel)
 *   3. o host da requisição (localhost em desenvolvimento, proxy na Vercel)
 */

export function urlPublicaDoApp(host?: string | null): URL {
  const hostFinal =
    host?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostFinal);
  const protocolo = local ? "http" : "https";
  const urlFinal =
    process.env.SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : `${protocolo}://${hostFinal}`);
  return new URL(urlFinal.startsWith("http") ? urlFinal : `https://${urlFinal}`);
}

/** Mesmo endereço, sem barra final (para mostrar e para o QR Code). */
export function urlPublicaDoAppTexto(host?: string | null) {
  return urlPublicaDoApp(host).toString().replace(/\/$/, "");
}
