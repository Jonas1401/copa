/**
 * Montagem do acervo do CopaFlix no SERVIDOR.
 *
 * Fontes autorizadas (todas opcionais, configuradas por variável de ambiente):
 *   COPAFLIX_M3U_URLS   listas M3U/M3U8 obtidas legalmente pelo administrador
 *   COPAFLIX_M3U_PRESET preset pronto de lista pública (hoje: br-publicos)
 *   COPAFLIX_M3U_INCLUIR / _EXCLUIR  curadoria por expressão regular
 *   COPAFLIX_EPG_URL    guia XMLTV (programa que está no ar)
 *   COPAFLIX_JELLYFIN_URL / _API_KEY / _USER_ID   servidor de mídia próprio
 *   COPAFLIX_TMDB_KEY   (ou TMDB_API_KEY) cartazes e fundos do TMDB
 *   COPAFLIX_DEMO=0     desliga o catálogo de demonstração (domínio público/CC)
 *   COPAFLIX_PERMITIR_REDE_INTERNA=1  libera IP privado (Jellyfin na LAN)
 *
 * Nada aqui roda no navegador: chaves e endereços internos não vazam para a
 * tela. Se uma fonte falhar, o restante do acervo continua no ar e a tela
 * mostra o aviso — nunca uma página em branco.
 */
import { DEMONSTRACAO, destaquesDe, montarCanais, montarCatalogo } from "./catalogo";
import { canaisDaLista, filtrarItensM3U, lerListaM3U, type FiltroM3U } from "./m3u";
import { lerEpg } from "./epg";
import { listarJellyfin } from "./jellyfin";
import { enriquecerComTmdb } from "./tmdb";
import { validarUrlExterna } from "./url-segura";
import type { Acervo, Canal, ProgramaAgora, StatusFonte, Titulo } from "./tipos";

const TTL_ACERVO_MS = 5 * 60_000;
const TTL_EPG_MS = 10 * 60_000;
const MAXIMO_M3U_BYTES = 4 * 1024 * 1024;
const MAXIMO_EPG_BYTES = 8 * 1024 * 1024;

/**
 * Presets de listas públicas. O CopaFlix não redistribui a lista: ele apenas
 * aponta para a publicação oficial do iptv-org (compilação em domínio público,
 * licença Unlicense) e aplica uma curadoria fixa pelas emissoras cuja
 * transmissão pública é autorizada — no caso, as emissoras públicas
 * brasileiras (EBC/TV Brasil, TV Câmara, TV Senado, TV Justiça, Canal Gov,
 * Canal Educação, Canal Saúde, Canal Futura, Cultura Pará).
 */
export const PRESETS_M3U: Record<string, { nome: string; url: string; incluir: string }> = {
  "br-publicos": {
    nome: "Emissoras públicas brasileiras (iptv-org)",
    url: "https://iptv-org.github.io/iptv/countries/br.m3u",
    incluir:
      "TVBrasil|TVCamara|TVSenado|TVJustica|CanalGov|CanalEducacao|CanalSaude|CanalFutura|CulturaPara",
  },
};

/**
 * Índices "completos" de listas públicas (milhares de canais de terceiros, sem
 * autorização verificada). São recusados de propósito quando não há curadoria:
 * copiar tudo contraria a regra do módulo (só fonte autorizada) e enche a tela
 * de canais instáveis, geo-bloqueados e sem direitos.
 */
const LISTAS_PUBLICAS_COMPLETAS = ["iptv-org.github.io/iptv/index.m3u", "iptv-org.github.io/iptv/all.m3u"];

export function ehListaPublicaCompleta(url: string) {
  const alvo = url.toLowerCase();
  return LISTAS_PUBLICAS_COMPLETAS.some((marca) => alvo.includes(marca));
}

export type ConfiguracaoCopaFlix = {
  demo: boolean;
  permitirRedeInterna: boolean;
  listasM3U: string[];
  presetsM3U: string[];
  /** Listas amplas recusadas por faltar curadoria (aparecem no painel). */
  listasRecusadas: string[];
  filtroM3U: FiltroM3U;
  epgUrl?: string;
  jellyfin?: { base: string; chave: string; usuarioId?: string };
  tmdbChave?: string;
};

function listaDeUrls(valor: string | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function textoLimpo(valor: string | undefined) {
  return (valor ?? "").trim();
}

/** Compila a curadoria sem derrubar o app: regex inválida é ignorada. */
function compilarRegex(valor: string | undefined): RegExp | undefined {
  const texto = textoLimpo(valor);
  if (!texto || texto.length > 200) return undefined;
  try {
    return new RegExp(texto, "i");
  } catch {
    console.warn("[copaflix] expressão de curadoria inválida — ignorada");
    return undefined;
  }
}

export function lerConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): ConfiguracaoCopaFlix {
  const permitirRedeInterna = textoLimpo(ambiente.COPAFLIX_PERMITIR_REDE_INTERNA) === "1";
  const opcoesRede = { permitirRedeInterna };

  const presetsM3U = listaDeUrls(ambiente.COPAFLIX_M3U_PRESET)
    .map((item) => item.toLowerCase())
    .filter((item) => Boolean(PRESETS_M3U[item]))
    .slice(0, 4);
  if (!presetsM3U.length && textoLimpo(ambiente.COPAFLIX_M3U_PRESET)) {
    console.warn("[copaflix] preset de lista desconhecido — ignorado");
  }

  const todasAsListas = [
    ...new Set([
      ...presetsM3U.map((id) => PRESETS_M3U[id].url),
      ...listaDeUrls(ambiente.COPAFLIX_M3U_URLS || ambiente.COPAFLIX_M3U_URL),
    ]),
  ].filter((url) => validarUrlExterna(url, opcoesRede).ok);

  // Curadoria: a variável do operador manda; sem ela, vale a regra do preset.
  const incluir =
    textoLimpo(ambiente.COPAFLIX_M3U_INCLUIR) ||
    (presetsM3U.length === 1 ? PRESETS_M3U[presetsM3U[0]].incluir : "");
  const filtroM3U: FiltroM3U = {
    incluir: compilarRegex(incluir),
    excluir: compilarRegex(ambiente.COPAFLIX_M3U_EXCLUIR),
  };

  // Lista completa de terceiros só entra com curadoria declarada.
  const listasRecusadas = filtroM3U.incluir
    ? []
    : todasAsListas.filter((url) => ehListaPublicaCompleta(url));
  if (listasRecusadas.length) {
    console.warn(
      "[copaflix] lista pública completa recusada sem curadoria — defina COPAFLIX_M3U_INCLUIR",
    );
  }
  const listasM3U = todasAsListas.filter((url) => !listasRecusadas.includes(url));

  const epg = textoLimpo(ambiente.COPAFLIX_EPG_URL);
  const epgUrl = epg && validarUrlExterna(epg, opcoesRede).ok ? epg : undefined;

  const jellyfinBase = textoLimpo(ambiente.COPAFLIX_JELLYFIN_URL);
  const jellyfinChave = textoLimpo(ambiente.COPAFLIX_JELLYFIN_API_KEY);
  const jellyfinOk = Boolean(jellyfinBase && jellyfinChave) &&
    validarUrlExterna(jellyfinBase, opcoesRede).ok;

  return {
    demo: textoLimpo(ambiente.COPAFLIX_DEMO) !== "0",
    permitirRedeInterna,
    listasM3U,
    presetsM3U,
    listasRecusadas,
    filtroM3U,
    epgUrl,
    jellyfin: jellyfinOk
      ? {
          base: jellyfinBase,
          chave: jellyfinChave,
          usuarioId: textoLimpo(ambiente.COPAFLIX_JELLYFIN_USER_ID) || undefined,
        }
      : undefined,
    tmdbChave: textoLimpo(ambiente.COPAFLIX_TMDB_KEY) || textoLimpo(ambiente.TMDB_API_KEY) || undefined,
  };
}

/* ---------------------------------------------------------------- download */

/** Lê até `maxBytes` de uma URL externa validada. */
async function baixarTexto(
  url: string,
  opcoes: { maxBytes: number; segundos: number; permitirRedeInterna: boolean },
): Promise<string> {
  const resposta = await fetch(url, {
    headers: { Accept: "text/plain, application/vnd.apple.mpegurl, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(opcoes.segundos * 1000),
    cache: "no-store",
    redirect: "follow",
  });
  if (!resposta.ok) throw new Error(`respondeu HTTP ${resposta.status}`);

  // O redirecionamento também é conferido: nada de cair num IP interno.
  const final = validarUrlExterna(resposta.url || url, {
    permitirRedeInterna: opcoes.permitirRedeInterna,
  });
  if (!final.ok) throw new Error("redirecionamento para endereço bloqueado");

  const tamanho = Number(resposta.headers.get("content-length") ?? 0);
  if (tamanho && tamanho > opcoes.maxBytes) throw new Error("arquivo grande demais");

  if (!resposta.body) return (await resposta.text()).slice(0, opcoes.maxBytes);

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder("utf-8");
  let texto = "";
  let lidos = 0;
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (value) {
      lidos += value.byteLength;
      texto += decodificador.decode(value, { stream: true });
      if (lidos >= opcoes.maxBytes) {
        await leitor.cancel().catch(() => {});
        break;
      }
    }
  }
  texto += decodificador.decode();
  return texto;
}

/* ------------------------------------------------------------------ acervo */

let cacheAcervo: { em: number; valor: Acervo } | null = null;
let emAndamento: Promise<Acervo> | null = null;

export function limparCacheCopaFlix() {
  cacheAcervo = null;
  emAndamento = null;
  cacheEpg = null;
}

/** Monta (ou reaproveita por 5 min) o acervo completo. Nunca lança erro. */
export async function carregarAcervo(
  config: ConfiguracaoCopaFlix = lerConfiguracao(),
  opcoes: { forcar?: boolean } = {},
): Promise<Acervo> {
  if (!opcoes.forcar && cacheAcervo && Date.now() - cacheAcervo.em < TTL_ACERVO_MS) {
    return cacheAcervo.valor;
  }
  if (!opcoes.forcar && emAndamento) return emAndamento;

  emAndamento = montarAcervo(config)
    .then((acervo) => {
      cacheAcervo = { em: Date.now(), valor: acervo };
      return acervo;
    })
    .catch((erro) => {
      console.error("[copaflix] falha ao montar o acervo:", erro);
      const vazio = montarAcervoLocal(config);
      cacheAcervo = { em: Date.now(), valor: vazio };
      return vazio;
    })
    .finally(() => {
      emAndamento = null;
    });

  return emAndamento;
}

function montarAcervoLocal(config: ConfiguracaoCopaFlix): Acervo {
  const titulos = montarCatalogo([], { demo: config.demo });
  const canais = montarCanais([], { demo: config.demo });
  return {
    titulos,
    canais,
    destaques: destaquesDe(titulos, 8),
    fontes: [
      {
        id: "catalogo-local",
        nome: "Catálogo de demonstração",
        configurada: config.demo,
        itens: config.demo ? DEMONSTRACAO.length : 0,
        detalhe: config.demo
          ? "Domínio público e Creative Commons"
          : "Desligado por COPAFLIX_DEMO=0",
      },
    ],
    demoAtivo: config.demo,
    tmdbAtivo: Boolean(config.tmdbChave),
    atualizadoEm: new Date().toISOString(),
  };
}

async function montarAcervo(config: ConfiguracaoCopaFlix): Promise<Acervo> {
  const avisos: StatusFonte[] = [];
  const titulosExtras: Titulo[] = [];
  const canaisExtras: Canal[] = [];

  // ------------------------------------------------------------- Jellyfin
  if (config.jellyfin) {
    try {
      const doJellyfin = await listarJellyfin(config.jellyfin);
      titulosExtras.push(...doJellyfin);
      avisos.push({
        id: "jellyfin",
        nome: "Biblioteca Jellyfin",
        configurada: true,
        itens: doJellyfin.length,
      });
    } catch (erro) {
      avisos.push({
        id: "jellyfin",
        nome: "Biblioteca Jellyfin",
        configurada: true,
        itens: 0,
        erro: erro instanceof Error ? erro.message.slice(0, 160) : "Servidor indisponível",
      });
    }
  } else {
    avisos.push({
      id: "jellyfin",
      nome: "Biblioteca Jellyfin",
      configurada: false,
      itens: 0,
      detalhe: "Configure COPAFLIX_JELLYFIN_URL e a chave da API",
    });
  }

  // --------------------------------------------------------- listas M3U
  if (config.listasM3U.length) {
    const resultados = await Promise.allSettled(
      config.listasM3U.map(async (url, indice) => {
        const texto = await baixarTexto(url, {
          maxBytes: MAXIMO_M3U_BYTES,
          segundos: 7,
          permitirRedeInterna: config.permitirRedeInterna,
        });
        const lidos = lerListaM3U(texto, { permitirRedeInterna: config.permitirRedeInterna });
        const itens = filtrarItensM3U(lidos, config.filtroM3U);
        return canaisDaLista(itens, { origemNome: `Lista autorizada ${indice + 1}` });
      }),
    );

    let falhas = 0;
    const canaisDasListas: Canal[] = [];
    for (const resultado of resultados) {
      if (resultado.status === "fulfilled") canaisDasListas.push(...resultado.value);
      else falhas++;
    }
    canaisExtras.push(...canaisDasListas);

    const curadoria = config.filtroM3U.incluir || config.filtroM3U.excluir;
    const recusadas = config.listasRecusadas.length;
    const nomeDoPreset = config.presetsM3U
      .map((id) => PRESETS_M3U[id]?.nome ?? id)
      .join(", ");
    avisos.push({
      id: "m3u",
      nome: "Listas M3U autorizadas",
      configurada: true,
      itens: canaisDasListas.length,
      detalhe: [
        `${config.listasM3U.length} lista(s)`,
        nomeDoPreset || null,
        curadoria ? "com curadoria" : null,
        recusadas ? `${recusadas} recusada(s) sem curadoria` : null,
        falhas ? `${falhas} indisponível(is)` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      erro: falhas === config.listasM3U.length ? "Nenhuma lista respondeu" : undefined,
    });
  } else {
    avisos.push({
      id: "m3u",
      nome: "Listas M3U autorizadas",
      configurada: false,
      itens: 0,
      detalhe: config.listasRecusadas.length
        ? "Lista pública completa recusada sem curadoria — informe COPAFLIX_M3U_INCLUIR"
        : "Configure COPAFLIX_M3U_URLS com uma lista obtida legalmente",
      erro: config.listasRecusadas.length ? "Sem lista autorizada" : undefined,
    });
  }

  // ------------------------------------------------------------ catálogo
  let titulos = montarCatalogo(titulosExtras, { demo: config.demo });

  if (config.tmdbChave) {
    titulos = await enriquecerComTmdb(titulos, config.tmdbChave, { limite: 8, prazoMs: 3500 });
  }
  avisos.unshift({
    id: "tmdb",
    nome: "Cartazes TMDB",
    configurada: Boolean(config.tmdbChave),
    itens: titulos.filter((t) => t.capa).length,
    detalhe: config.tmdbChave
      ? "Atribuição exibida no rodapé do CopaFlix"
      : "Sem chave: o app usa a arte própria (nada é enviado ao TMDB)",
  });

  if (config.demo) {
    avisos.unshift({
      id: "catalogo-local",
      nome: "Catálogo de demonstração",
      configurada: true,
      itens: DEMONSTRACAO.length,
      detalhe: "Domínio público e Creative Commons",
    });
  } else {
    avisos.unshift({
      id: "catalogo-local",
      nome: "Catálogo de demonstração",
      configurada: false,
      itens: 0,
      detalhe: "Desligado por COPAFLIX_DEMO=0",
    });
  }

  // Os canais oficiais de exemplo só aparecem quando NÃO há lista autorizada
  // configurada — a operação não deve ver canal de demonstração misturado.
  const canais: Canal[] =
    canaisExtras.length || !config.demo
      ? canaisExtras
      : montarCanais([], { demo: true });

  return {
    titulos,
    canais,
    destaques: destaquesDe(titulos, 8),
    fontes: avisos,
    demoAtivo: config.demo,
    tmdbAtivo: Boolean(config.tmdbChave),
    atualizadoEm: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------- EPG */

let cacheEpg: { em: number; valor: ProgramaAgora[] } | null = null;

export async function carregarEpg(
  config: ConfiguracaoCopaFlix = lerConfiguracao(),
  opcoes: { forcar?: boolean } = {},
): Promise<ProgramaAgora[]> {
  if (!config.epgUrl) return [];
  if (!opcoes.forcar && cacheEpg && Date.now() - cacheEpg.em < TTL_EPG_MS) return cacheEpg.valor;

  try {
    const xml = await baixarTexto(config.epgUrl, {
      maxBytes: MAXIMO_EPG_BYTES,
      segundos: 8,
      permitirRedeInterna: config.permitirRedeInterna,
    });
    const programas = lerEpg(xml, new Date());
    cacheEpg = { em: Date.now(), valor: programas };
    return programas;
  } catch (erro) {
    console.error("[copaflix] guia de programação indisponível:", erro);
    return cacheEpg?.valor ?? [];
  }
}
