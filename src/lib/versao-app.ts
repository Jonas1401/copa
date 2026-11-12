/**
 * O carimbo desta publicação — o mesmo no código que vai para o celular e no
 * servidor de uma mesma publicação (vem do `next.config.ts`, na hora da
 * compilação). A tela compara o dela com o que `/api/versao` responde: se for
 * outro, há uma publicação mais nova no ar (`VigiaDeVersao`).
 *
 * Vazio = não se sabe (compilação fora da Vercel sem `VERSAO_APP`): o vigia
 * fica desligado.
 */
export const VERSAO_DO_APP: string = (process.env.NEXT_PUBLIC_VERSAO_APP ?? "").trim();
