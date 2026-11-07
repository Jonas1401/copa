/**
 * Migração do pacote oficial de figurinhas do chat.
 *
 * O catálogo antigo (22 figurinhas desenhadas em SVG) é substituído pelo
 * pacote recortado da folha CopaLinks Caminhões e Bordo (42 figurinhas).
 * A troca é versionada: roda uma única vez por banco, dentro de transação,
 * e não reaparece se o administrador apagar as figurinhas depois.
 *
 * Para não apagar figurinhas publicadas pelo admin, a remoção do pacote
 * antigo casa o MD5 exato do base64 gravado em `figurinhas_catalogo.dados`.
 * Assim, uma figurinha customizada com o mesmo nome não é removida.
 */

/** Identificador do pacote atual (coluna `pacote`). */
export const PACOTE_FIGURINHAS_ID = "copalinks-bordo";

/** Versão da semente. Mudou o pacote? Incremente aqui. */
export const VERSAO_PACOTE_FIGURINHAS = "copalinks-bordo-42";

/** Marca na tabela `configuracao`. */
export const CHAVE_SEMENTE_FIGURINHAS = `figurinhas_pacote_${VERSAO_PACOTE_FIGURINHAS}`;

/** Pacote oficial anterior (coluna `pacote` antiga). */
export const PACOTE_FIGURINHAS_ANTERIOR_ID = "copalinks";

/**
 * MD5 do campo `dados` (base64 WebP) das 22 figurinhas antigas.
 * Gerado a partir do pacote SVG antes da substituição.
 */
export const HASHES_PACOTE_ANTERIOR = [
  "85db41af20f063f1be4b7e1b2dad5ab8", // caminhao-feliz
  "7b9d81e5ca2045fac6c385665350aae2", // caminhao-carregado
  "77e2aae14a93a82cb93694946a88ab88", // caminhao-veloz
  "2f6362727efba3bab8129243c639fe15", // caminhao-chuva
  "e07f317f3a5c251e60da3586cf1e926e", // caminhao-luz-verde
  "6b482015eca38710e7d3912e0cf29183", // cafezinho
  "1a551493bc15066961e6fa4c61486849", // bom-dia
  "a703babd16b3f085584223ac6d0caf41", // joinha
  "08bedb1606ea9dd91a2470ba1746c70f", // motorista-top
  "ac71cd03eb68908d4577eee6608cea19", // tamo-junto
  "182ed6f697850bff312b11d6174fba28", // acenando
  "64ba8d88d1f3e1fd2ead13419078fefa", // descanso
  "ee35e84bb2fb070c885972144096187f", // navio
  "0bb0b0c5589a6f43319d126a0e751d41", // guindaste
  "2c38aaafc4164fb9e56e62251a9a7a5e", // fila-porto
  "dcc91718cec527249f81070efb20dfb9", // balanca
  "560e437049805ec681d3f4b30d3d394b", // containers
  "d2f4b2b31b42ef541ec52f156cc79553", // porto-noite
  "8a670580f161c51ab3201363da266ec1", // estrela-copa
  "841e1f847b37e4d1eea8c4fb2c828110", // coracao-caminhao
  "ce09fff6d7e0876d02af1dab4d191051", // show-bola
  "f871e4e9234f42efbe015a59bdc2169a", // valeu
] as const;
