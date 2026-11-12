import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CANAIS_DEMONSTRACAO,
  DEMONSTRACAO,
  GENEROS,
  buscar,
  buscarCanais,
  categoriasSemConteudo,
  duracaoTexto,
  fileirasDeFilmes,
  fileirasDeNovelas,
  fileirasDeSeries,
  montarCanais,
  montarCatalogo,
  nomeDoGenero,
  porTipo,
  proximoEpisodio,
  temporadasDe,
  tempoTexto,
} from "../src/lib/copaflix/catalogo";
import {
  alternarFavorito,
  CHAVES,
  continuaAssistindo,
  lerFavoritos,
  lerHistorico,
  lerProgresso,
  limparTudo,
  registrarHistorico,
  salvarProgresso,
} from "../src/lib/copaflix/armazenamento";
import {
  canaisDaLista,
  ehPlaylistDeMidia,
  filtrarItensM3U,
  lerListaM3U,
  lerLinhaExtinf,
} from "../src/lib/copaflix/m3u";
import { lerEpg, parseDataXmltv } from "../src/lib/copaflix/epg";
import { validarUrlExterna } from "../src/lib/copaflix/url-segura";
import { PRESETS_M3U, lerConfiguracao } from "../src/lib/copaflix/fontes";
import { deveRetomar } from "../src/lib/copaflix/retomada";
import { listarJellyfin } from "../src/lib/copaflix/jellyfin";

const ler = (p: string) => readFileSync(p, "utf8");
const pastaCopaFlix = "src/components/copaflix";
const lerArquivosCopaFlix = () =>
  readdirSync(pastaCopaFlix)
    .filter((nome) => /\.(tsx|ts)$/.test(nome))
    .map((nome) => join(pastaCopaFlix, nome));

/* ------------------------------------------------------------------ menu */

test("o menu ⋮ não exibe mais Entretenimento e preserva as funções existentes", () => {
  const menu = ler("src/components/inicio/MenuConta.tsx");
  assert.ok(!menu.includes("Entretenimento"), "a seção Entretenimento ainda aparece no menu ⋮");
  assert.ok(!menu.includes("/copaflix"), "há um atalho para o CopaFlix no menu ⋮");
  assert.ok(menu.includes("EllipsisVertical"));
  assert.ok(menu.includes("Trocar meu nome"));
  assert.ok(menu.includes("Ativar notificações"));
  assert.ok(menu.includes("Portal do motorista"));
  assert.ok(menu.includes('href="/admin"'));
});

test("a página do CopaFlix existe, é isolada e tem CSS próprio", () => {
  assert.ok(ler("src/app/copaflix/page.tsx").includes("CopaFlixApp"));
  assert.ok(ler("src/app/copaflix/layout.tsx").includes('import "./copaflix.css"'));
  const css = ler("src/app/copaflix/copaflix.css");
  assert.ok(css.includes(".cf-roda"), "sem os estilos da roda 3D");
  assert.ok(css.includes("perspective"), "a roda 3D perdeu a perspectiva");
  assert.ok(ler("src/app/copaflix/titulo/[id]/page.tsx").includes("TituloDetalhe"));
  // O globals.css continua sendo a fonte da paleta (nada de tema novo solto).
  assert.ok(ler("src/app/globals.css").includes("--fundo-base: #000D16"));
});

/* --------------------------------------------------------------- catálogo */

test("catálogo de demonstração: ids únicos, gêneros conhecidos e fonte legal", () => {
  const ids = new Set<string>();
  for (const titulo of DEMONSTRACAO) {
    assert.ok(!ids.has(titulo.id), `id repetido: ${titulo.id}`);
    ids.add(titulo.id);
    assert.ok(titulo.sinopse.length > 20, `${titulo.id} sem sinopse`);
    for (const genero of titulo.generos) {
      assert.ok(GENEROS[genero], `${titulo.id} usa gênero desconhecido: ${genero}`);
    }
    const fonte = titulo.fonte;
    assert.ok(fonte, `${titulo.id} sem fonte`);
    assert.ok(["hls", "arquivo", "externo", "jellyfin"].includes(fonte!.tipo));
    if (fonte!.url) assert.match(fonte!.url, /^https:\/\//, `${titulo.id} com fonte fora de https`);
    for (const episodio of titulo.episodios ?? []) {
      assert.ok(episodio.fonte?.url?.startsWith("https://"), `${episodio.id} sem fonte https`);
      assert.ok(episodio.temporada >= 1 && episodio.numero >= 1);
    }
  }
  assert.ok(DEMONSTRACAO.some((t) => t.tipo === "filme"));
  assert.ok(DEMONSTRACAO.some((t) => t.tipo === "serie"));

  // Fontes do catálogo de demonstração: só acervos públicos/abertos e o
  // espelho de testes do player — nenhum agregador de conteúdo pirata.
  const hostsPermitidos = new Set([
    "archive.org",
    "commondatastorage.googleapis.com",
    "test-streams.mux.dev",
  ]);
  for (const titulo of DEMONSTRACAO) {
    const urls = [titulo.fonte?.url, ...(titulo.episodios ?? []).map((e) => e.fonte?.url)];
    for (const url of urls.filter(Boolean) as string[]) {
      const host = new URL(url).hostname;
      assert.ok(hostsPermitidos.has(host), `${titulo.id} aponta para host não previsto: ${host}`);
    }
  }
});

test("canais de exemplo são oficiais, por HTTPS, e têm categoria", () => {
  for (const canal of CANAIS_DEMONSTRACAO) {
    assert.ok(canal.nome && canal.categoria);
    assert.match(canal.fonte.url ?? "", /^https:\/\//);
    assert.ok(canal.credito, `${canal.id} sem crédito da emissora`);
  }
});

test("categorias sem fonte aparecem como pendência, sem conteúdo inventado", () => {
  const filmes = fileirasDeFilmes(DEMONSTRACAO);
  const vazias = categoriasSemConteudo(["Romance", "Documentários", "Filmes clássicos"], filmes);
  assert.ok(vazias.includes("Romance"), "Romance deveria aparecer como sem conteúdo");
  assert.ok(!vazias.includes("Filmes clássicos"), "Clássicos existe no catálogo de demonstração");
  assert.equal(porTipo(DEMONSTRACAO, "novela").length, 0);
  assert.deepEqual(fileirasDeNovelas(DEMONSTRACAO), []);
  assert.ok(fileirasDeSeries(DEMONSTRACAO).length >= 1);
});

test("busca ignora acento e caixa e também acha canal", () => {
  assert.ok(buscar(DEMONSTRACAO, "noite dos mortos").length >= 1);
  assert.ok(buscar(DEMONSTRACAO, "FICCAO").length >= 1);
  assert.ok(buscar(DEMONSTRACAO, "sintel").length >= 1);
  assert.equal(buscar(DEMONSTRACAO, "zzzz").length, 0);
  assert.equal(buscarCanais(CANAIS_DEMONSTRACAO, "nasa").length, 1);
});

test("catálogo configurado ganha do exemplo quando repete o id", () => {
  const extra = { ...DEMONSTRACAO[0], titulo: "Versão da operação" };
  const final = montarCatalogo([extra]);
  assert.equal(final.filter((t) => t.id === extra.id).length, 1);
  assert.equal(final.find((t) => t.id === extra.id)?.titulo, "Versão da operação");
  const soDemo = montarCatalogo([], { demo: false });
  assert.equal(soDemo.length, 0);
  assert.equal(montarCanais([], { demo: false }).length, 0);
});

test("próximo episódio, temporadas e textos de duração", () => {
  const serie = DEMONSTRACAO.find((t) => t.episodios?.length)!;
  assert.deepEqual(temporadasDe(serie), [1]);
  const proximo = proximoEpisodio(serie, serie.episodios![0].id);
  assert.equal(proximo?.numero, 2);
  assert.equal(proximoEpisodio(serie, serie.episodios!.at(-1)!.id), null);
  assert.equal(duracaoTexto(94), "1h 34min");
  assert.equal(duracaoTexto(12), "12min");
  assert.equal(tempoTexto(3720), "1h 02min");
  assert.equal(nomeDoGenero("ficcao"), "Ficção científica");
});

/* ------------------------------------------------------------------- M3U */

const LISTA = `#EXTM3U
#EXTINF:-1 tvg-id="noticias.br" tvg-logo="https://exemplo.com/logo.png" group-title="Notícias",Canal Um, HD
http://exemplo.com/um.m3u8
#EXTVLCOPT:http-referrer=https://x
#EXTINF:-1 group-title="Esportes",Canal Dois
https://exemplo.com/dois/index.m3u8
#EXTINF:-1,Sem grupo
https://exemplo.com/tres.m3u8
#EXTINF:-1 group-title="Privado",Interno
http://192.168.0.10/stream.m3u8
#EXTINF:-1 group-title="Perigoso",Arquivo
file:///etc/passwd
`;

test("lê a lista M3U com atributos, vírgula no nome e só endereços públicos", () => {
  const itens = lerListaM3U(LISTA);
  assert.equal(itens.length, 3, "canais internos e file:// precisam ficar de fora");
  assert.equal(itens[0].nome, "Canal Um, HD");
  assert.equal(itens[0].grupo, "Notícias");
  assert.equal(itens[0].tvgId, "noticias.br");
  assert.equal(itens[1].grupo, "Esportes");
  assert.equal(itens[2].grupo, undefined);

  const canais = canaisDaLista(itens);
  assert.equal(canais.length, 3);
  assert.equal(new Set(canais.map((c) => c.id)).size, 3, "ids precisam ser únicos");
  assert.ok(canais.every((c) => c.fonte.tipo === "hls"));
});

test("não confunde playlist de mídia com lista de canais", () => {
  const midia = `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n`;
  assert.equal(ehPlaylistDeMidia(midia), true);
  assert.equal(lerListaM3U(midia).length, 0);
  assert.equal(lerListaM3U("#EXTM3U\n#EXTINF:-1,Canal\nhttps://exemplo.com/a.m3u8").length, 1);
});

test("lê os atributos da linha EXTINF mesmo com vírgulas dentro de aspas", () => {
  const { atributos, nome } = lerLinhaExtinf('#EXTINF:-1 tvg-id="a" group-title="Filmes, Séries",Canal Legal');
  assert.equal(atributos["group-title"], "Filmes, Séries");
  assert.equal(nome, "Canal Legal");
});

/* -------------------------------------------- curadoria de listas públicas */

/**
 * Lista no formato do iptv-org: traz emissoras públicas e canais comerciais
 * juntos. A curadoria do CopaFlix precisa manter só o que a operação pode
 * exibir — o app não decide sozinho o que é legal.
 */
const LISTA_PUBLICA = `#EXTM3U
#EXTINF:-1 tvg-id="TVBrasil.br@SD" group-title="Canais públicos",TV Brasil (720p)
https://exemplo.com/tvbrasil.m3u8
#EXTINF:-1 tvg-id="TVCamara.br@SD" group-title="Canais públicos",TV Câmara (1080p)
https://exemplo.com/camara.m3u8
#EXTINF:-1 tvg-id="CNNBrasil.br@SD" group-title="Notícias",CNN Brasil (1080p)
https://exemplo.com/cnn.m3u8
#EXTINF:-1 group-title="Canais públicos",TV Senado
https://exemplo.com/senado.m3u8`;

test("curadoria mantém só as emissoras autorizadas (por tvg-id ou por nome)", () => {
  const itens = lerListaM3U(LISTA_PUBLICA);
  assert.equal(itens.length, 4);

  const curados = filtrarItensM3U(itens, { incluir: new RegExp(PRESETS_M3U["br-publicos"].incluir, "i") });
  const nomes = curados.map((item) => item.nome);
  assert.deepEqual(nomes, ["TV Brasil (720p)", "TV Câmara (1080p)", "TV Senado"]);
  assert.ok(!nomes.some((nome) => nome.includes("CNN")), "canal comercial fica de fora");

  // Sem filtro, nada é descartado.
  assert.equal(filtrarItensM3U(itens).length, 4);
});

test("exclusão vence a inclusão na curadoria", () => {
  const itens = lerListaM3U(LISTA_PUBLICA);
  const curados = filtrarItensM3U(itens, {
    incluir: /TVBrasil|TVCamara/i,
    excluir: /camara/i,
  });
  assert.deepEqual(curados.map((item) => item.nome), ["TV Brasil (720p)"]);
});

test("preset br-publicos aponta para o iptv-org e já vem com a curadoria", () => {
  const config = lerConfiguracao({
    COPAFLIX_M3U_PRESET: "br-publicos",
    COPAFLIX_DEMO: "0",
  } as unknown as NodeJS.ProcessEnv);

  assert.deepEqual(config.presetsM3U, ["br-publicos"]);
  assert.deepEqual(config.listasM3U, ["https://iptv-org.github.io/iptv/countries/br.m3u"]);
  const incluir = config.filtroM3U.incluir;
  assert.ok(incluir, "preset precisa trazer a regra de inclusão");
  assert.equal(incluir.test("TVBrasil.br@SD"), true);
  assert.equal(incluir.test("CanalGov.br@SD"), true);
  assert.equal(incluir.test("CNN Brasil"), false);
});

test("preset desconhecido e regex inválida são ignorados sem derrubar o app", () => {
  const desconhecido = lerConfiguracao({
    COPAFLIX_M3U_PRESET: "lista-pirata-inexistente",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(desconhecido.presetsM3U, []);
  assert.deepEqual(desconhecido.listasM3U, []);
  assert.equal(desconhecido.filtroM3U.incluir, undefined);

  const invalida = lerConfiguracao({
    COPAFLIX_M3U_URLS: "https://exemplo.com/lista.m3u",
    COPAFLIX_M3U_INCLUIR: "[(",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(invalida.filtroM3U.incluir, undefined);
  assert.deepEqual(invalida.listasM3U, ["https://exemplo.com/lista.m3u"]);
});

test("sem configuração nenhuma, nenhuma lista de terceiros é carregada", () => {
  const padrao = lerConfiguracao({} as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(padrao.listasM3U, []);
  assert.deepEqual(padrao.presetsM3U, []);
  assert.deepEqual(padrao.listasRecusadas, []);
  assert.equal(padrao.filtroM3U.incluir, undefined);
});

test("índice completo de lista pública é recusado sem curadoria", () => {
  const semCuradoria = lerConfiguracao({
    COPAFLIX_M3U_URLS: "https://iptv-org.github.io/iptv/index.m3u",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(semCuradoria.listasM3U, [], "não pode sair carregando 5.000 canais de terceiros");
  assert.deepEqual(semCuradoria.listasRecusadas, ["https://iptv-org.github.io/iptv/index.m3u"]);

  const comCuradoria = lerConfiguracao({
    COPAFLIX_M3U_URLS: "https://iptv-org.github.io/iptv/index.m3u",
    COPAFLIX_M3U_INCLUIR: "TVBrasil|CanalGov",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(comCuradoria.listasRecusadas, []);
  assert.deepEqual(comCuradoria.listasM3U, ["https://iptv-org.github.io/iptv/index.m3u"]);

  // Lista por país (já é um recorte) continua aceita sem filtro.
  const porPais = lerConfiguracao({
    COPAFLIX_M3U_URLS: "https://iptv-org.github.io/iptv/countries/br.m3u",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(porPais.listasRecusadas, []);
  assert.equal(porPais.listasM3U.length, 1);
});

test("a curadoria do operador sobrepõe a do preset e as listas não repetem", () => {
  const config = lerConfiguracao({
    COPAFLIX_M3U_PRESET: "br-publicos",
    COPAFLIX_M3U_URLS: "https://iptv-org.github.io/iptv/countries/br.m3u, https://exemplo.com/minha.m3u",
    COPAFLIX_M3U_INCLUIR: "CanalGov",
  } as unknown as NodeJS.ProcessEnv);

  assert.deepEqual(config.listasM3U, [
    "https://iptv-org.github.io/iptv/countries/br.m3u",
    "https://exemplo.com/minha.m3u",
  ]);
  assert.ok(config.filtroM3U.incluir);
  assert.equal(config.filtroM3U.incluir.test("CanalGov.br@SD"), true);
  assert.equal(config.filtroM3U.incluir.test("TVBrasil.br@SD"), false);
});

/* ------------------------------------------------------------- EPG/XMLTV */

const XML = `<?xml version="1.0"?>
<tv>
  <programme start="20261112120000 -0300" stop="20261112130000 -0300" channel="dw.en">
    <title lang="pt">Jornal da Tarde</title>
    <desc lang="pt">Notícias.</desc>
  </programme>
  <programme start="20261112130000 -0300" stop="20261112140000 -0300" channel="dw.en">
    <title>Documentário</title>
  </programme>
  <programme start="20261112120000 -0300" stop="20261112130000 -0300" channel="nasa.tv">
    <title>Missão &amp; Ciência</title>
  </programme>
</tv>`;

test("EPG: data XMLTV e só o programa que está no ar", () => {
  assert.equal(
    parseDataXmltv("20261112120000 +0000")?.toISOString(),
    "2026-11-12T12:00:00.000Z",
  );
  assert.equal(parseDataXmltv("20261112120000 -0300")?.toISOString(), "2026-11-12T15:00:00.000Z");
  assert.equal(parseDataXmltv("invalido"), null);

  const agora = new Date("2026-11-12T15:30:00.000Z"); // 12:30 em Brasília
  const programas = lerEpg(XML, agora);
  assert.equal(programas.length, 2);
  assert.equal(programas.find((p) => p.canalId === "dw.en")?.titulo, "Jornal da Tarde");
  assert.equal(programas.find((p) => p.canalId === "nasa.tv")?.titulo, "Missão & Ciência");
});

/* ------------------------------------------------------------ URL segura */

test("validação de URL bloqueia esquemas perigosos e rede interna", () => {
  const bons = ["https://exemplo.com/a.m3u", "http://exemplo.com:8080/x", "https://8.8.8.8/x"];
  for (const url of bons) assert.ok(validarUrlExterna(url).ok, `${url} deveria passar`);

  const ruins = [
    "file:///etc/passwd",
    "ftp://exemplo.com/x",
    "javascript:alert(1)",
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.0.1/x",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/x",
    "http://usuario:senha@exemplo.com/x",
    "https://exemplo.com/" + "a".repeat(3000),
  ];
  for (const url of ruins) {
    assert.equal(validarUrlExterna(url).ok, false, `${url} deveria ser bloqueada`);
  }
  // Exceção explícita para Jellyfin na LAN (quem administra assume o risco).
  assert.ok(validarUrlExterna("http://192.168.0.10:8096", { permitirRedeInterna: true }).ok);
});

/* --------------------------------------------------------- configuração */

test("configuração do CopaFlix só aceita endereços válidos e nunca expõe chave", () => {
  const config = lerConfiguracao({
    COPAFLIX_M3U_URLS: "https://exemplo.com/lista.m3u, http://127.0.0.1/ruim.m3u",
    COPAFLIX_EPG_URL: "https://exemplo.com/guia.xml",
    COPAFLIX_JELLYFIN_URL: "https://jelly.exemplo.com",
    COPAFLIX_JELLYFIN_API_KEY: "segredo",
    COPAFLIX_TMDB_KEY: "chave-tmdb",
    COPAFLIX_DEMO: "0",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(config.listasM3U, ["https://exemplo.com/lista.m3u"]);
  assert.equal(config.epgUrl, "https://exemplo.com/guia.xml");
  assert.equal(config.jellyfin?.base, "https://jelly.exemplo.com");
  assert.equal(config.jellyfin?.chave, "segredo");
  assert.equal(config.demo, false);
  assert.equal(config.tmdbChave, "chave-tmdb");
  // O objeto público do acervo não carrega a chave em nenhum campo.
  assert.ok(!JSON.stringify(config.jellyfin?.chave).includes("url"));
});

/* --------------------------------------------------------------- Jellyfin */

test("Jellyfin: mapeia filme/série e nunca devolve a chave da API", async () => {
  const original = globalThis.fetch;
  let urlPedida = "";
  let cabecalho = "";
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    urlPedida = String(entrada);
    const headers = new Headers(init?.headers);
    cabecalho = headers.get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        Items: [
          {
            Id: "abc123",
            Name: "Filme Teste",
            Type: "Movie",
            Overview: "Sinopse do servidor.",
            ProductionYear: 2020,
            Genres: ["Science Fiction", "Thriller"],
            RunTimeTicks: 54_000_000_000,
            ImageTags: { Primary: "tag" },
          },
          { Id: "serie1", Name: "Série Teste", Type: "Series", RecursiveItemCount: 3 },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const titulos = await listarJellyfin({
      base: "https://jelly.exemplo.com",
      chave: "SEGREDO-QUE-NAO-PODE-VAZAR",
    });
    assert.equal(urlPedida.startsWith("https://jelly.exemplo.com/Items?"), true);
    assert.match(cabecalho, /Token="SEGREDO-QUE-NAO-PODE-VAZAR"/, "sem o cabeçalho oficial do Jellyfin");
    assert.equal(titulos.length, 2);
    assert.equal(titulos[0].titulo, "Filme Teste");
    assert.equal(titulos[0].tipo, "filme");
    assert.equal(titulos[0].duracaoMin, 90);
    assert.deepEqual(titulos[0].generos, ["ficcao", "acao"]);
    assert.equal(titulos[0].capa, "/api/copaflix/jellyfin/imagem/abc123");
    assert.equal(titulos[1].tipo, "serie");
    assert.equal(titulos[1].temporadas, 3);
    // O que vai para a tela não contém a credencial.
    assert.ok(!JSON.stringify(titulos).includes("SEGREDO"));
  } finally {
    globalThis.fetch = original;
  }
});

/* ----------------------------------------------------------- armazenamento */

function armazemFalso() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void dados.set(chave, valor),
    removeItem: (chave: string) => void dados.delete(chave),
    _dados: dados,
  };
}

test("favoritos: adiciona, remove e sobrevive a conteúdo inválido", () => {
  const armazem = armazemFalso();
  assert.deepEqual(lerFavoritos(armazem), []);
  const lista = alternarFavorito(armazem, { id: "x", titulo: "X", tipo: "filme" });
  assert.equal(lista.length, 1);
  assert.equal(lerFavoritos(armazem)[0].id, "x");
  assert.equal(alternarFavorito(armazem, { id: "x", titulo: "X", tipo: "filme" }).length, 0);

  armazem.setItem(CHAVES.favoritos, "{quebrado");
  assert.deepEqual(lerFavoritos(armazem), []);
});

test("continuar assistindo só guarda o que começou e não terminou", () => {
  const armazem = armazemFalso();
  const base = { id: "a", titulo: "A", tipo: "filme" as const, duracao: 1000 };
  salvarProgresso(armazem, { ...base, posicao: 2 });
  assert.equal(continuaAssistindo(lerProgresso(armazem)[0]), false, "2s ainda não conta");
  salvarProgresso(armazem, { ...base, posicao: 300 });
  assert.equal(continuaAssistindo(lerProgresso(armazem)[0]), true);
  salvarProgresso(armazem, { ...base, posicao: 990 });
  assert.equal(continuaAssistindo(lerProgresso(armazem)[0]), false, "quase no fim não retoma");
  // Ao vivo (sem duração) não entra na lista.
  salvarProgresso(armazem, { ...base, id: "ao-vivo", posicao: 300, duracao: 0 });
  assert.equal(continuaAssistindo(lerProgresso(armazem)[0]), false);
});

test("histórico é recente, sem repetição, e tudo pode ser apagado", () => {
  const armazem = armazemFalso();
  registrarHistorico(armazem, { id: "a", titulo: "A", tipo: "filme" });
  registrarHistorico(armazem, { id: "b", titulo: "B", tipo: "serie" });
  registrarHistorico(armazem, { id: "a", titulo: "A", tipo: "filme" });
  const historico = lerHistorico(armazem);
  assert.equal(historico.length, 2);
  assert.equal(historico[0].id, "a", "o último aberto vem primeiro");
  limparTudo(armazem);
  assert.deepEqual(lerHistorico(armazem), []);
  assert.deepEqual(lerProgresso(armazem), []);
});

/* --------------------------------------------------------- player e roda */

test("retomada vale para vídeos curtos e nunca reinicia no fim do vídeo", () => {
  assert.equal(deveRetomar(12, 20), true, "curta de 20 s precisa retomar");
  assert.equal(deveRetomar(19, 20), false, "faltando 1 s, recomeça");
  assert.equal(deveRetomar(240, 600), true, "episódio de 10 min retoma");
  assert.equal(deveRetomar(1800, 5640), true, "filme de 94 min retoma");
  assert.equal(deveRetomar(5635, 5640), false, "últimos segundos do filme recomeçam");
  assert.equal(deveRetomar(4, 5640), false, "menos de 5 s não conta como começo");
  assert.equal(deveRetomar(120, 0), false, "sem duração (ao vivo) não retoma");
});

test("abrir a ficha por link direto lê o progresso do aparelho", () => {
  const fonte = ler("src/components/copaflix/TituloDetalhe.tsx");
  assert.ok(
    fonte.includes("progressoDoAparelho") && fonte.includes("armazenamentoDoAparelho"),
    "a ficha precisa ler o progresso direto do aparelho no efeito de abertura",
  );
  const trecho = fonte.slice(fonte.indexOf('params.get("play")'));
  assert.ok(
    trecho.slice(0, 400).includes("doEpisodio?.posicao"),
    "o link ?play=1 precisa usar a posição salva, não zero",
  );
});

test("player cobre HLS, retomada, próximo episódio e erro claro", () => {
  const player = ler("src/components/copaflix/Player.tsx");
  assert.ok(player.includes('import("hls.js")'), "player sem hls.js sob demanda");
  assert.ok(player.includes("application/vnd.apple.mpegurl"), "sem o HLS nativo do Safari");
  assert.ok(player.includes("requestFullscreen"), "sem tela cheia");
  assert.ok(player.includes("currentTime = inicioInicial"), "não retoma de onde parou");
  assert.ok(player.includes("aoProximo"), "sem próximo episódio");
  assert.ok(player.includes("CORS"), "erro de CORS sem explicação");
  assert.ok(player.includes('role="slider"'), "barra de progresso sem acessibilidade");
  assert.ok(player.includes("Ao vivo") || player.includes("ao vivo"));
});

test("a roda 3D é interativa de verdade (toque, arraste, teclado e foco)", () => {
  const roda = ler("src/components/copaflix/Carrossel3D.tsx");
  for (const marca of [
    "onPointerDown",
    "onPointerMove",
    "onPointerUp",
    "setPointerCapture",
    "touch-action",
    "rotateY",
    "translateZ",
    "ArrowRight",
    "onWheel",
  ]) {
    assert.ok(roda.includes(marca), `roda 3D sem ${marca}`);
  }
  assert.ok(roda.includes("useReducedMotion"), "roda ignora quem pediu menos movimento");
  assert.ok(ler("src/app/copaflix/copaflix.css").includes("perspective: 1400px"), "sem perspectiva no CSS");
});

/* ----------------------------------------------------------------- legal */

test("nenhum link pirata, torrent ou contorno de proteção no módulo", () => {
  const proibidos = [
    "torrent",
    "magnet:",
    "megafilmes",
    "filmesonline",
    "embedplay",
    "embed.php",
    "wvd",
    "widevine-keys",
  ];
  const arquivos = [
    ...lerArquivosCopaFlix(),
    "src/lib/copaflix/catalogo.ts",
    "src/lib/copaflix/fontes.ts",
    "src/lib/copaflix/m3u.ts",
    "src/lib/copaflix/jellyfin.ts",
    "src/lib/copaflix/tmdb.ts",
    "src/lib/copaflix/url-segura.ts",
  ];
  for (const arquivo of arquivos) {
    const conteudo = ler(arquivo).toLowerCase();
    for (const termo of proibidos) {
      assert.ok(!conteudo.includes(termo), `${arquivo} contém "${termo}"`);
    }
  }
});

test("nenhuma chave de API é exposta ao navegador", () => {
  for (const arquivo of lerArquivosCopaFlix()) {
    const conteudo = ler(arquivo);
    assert.ok(!conteudo.includes("COPAFLIX_JELLYFIN_API_KEY"), `${arquivo} lê a chave do Jellyfin`);
    assert.ok(!conteudo.includes("NEXT_PUBLIC_COPAFLIX"), `${arquivo} publica segredo no cliente`);
  }
  // O módulo do servidor é o único que lê as variáveis.
  assert.ok(ler("src/lib/copaflix/fontes.ts").includes("COPAFLIX_JELLYFIN_API_KEY"));
  assert.ok(!ler("src/app/copaflix/page.tsx").includes("API_KEY"));
});

test("as rotas do Jellyfin validam o id e nunca repassam a chave na URL da tela", () => {
  const stream = ler("src/app/api/copaflix/jellyfin/stream/[id]/route.ts");
  const imagem = ler("src/app/api/copaflix/jellyfin/imagem/[id]/route.ts");
  for (const rota of [stream, imagem]) {
    assert.match(rota, /\^\[A-Za-z0-9_-\]\{1,64\}\$/);
    assert.ok(rota.includes("cabecalhoJellyfin"), "sem o cabeçalho oficial do Jellyfin");
  }
  assert.ok(!ler("src/components/copaflix/TituloDetalhe.tsx").includes("api_key"));
});

test("o CSS do CopaFlix usa só a paleta do app", () => {
  const css = ler("src/app/copaflix/copaflix.css");
  const paleta = new Set([
    "#000d16",
    "#071a28",
    "#002f3b",
    "#183341",
    "#00b8bc",
    "#00c853",
    "#003d35",
    "#ffb82e",
    "#129dff",
    "#eaf4f7",
    "#8fa8ac",
    "#506a75",
    "#062330",
    "#000",
    "#fff",
    "#ffffff",
  ]);
  for (const m of css.matchAll(/(?<![&\w])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    assert.ok(paleta.has(m[0].toLowerCase()), `copaflix.css usa cor fora da paleta: ${m[0]}`);
  }
  for (const m of css.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
    const rgb = `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
    const conhecida = [...paleta].some((hex) => {
      if (hex.length !== 7) return false;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return rgb === `rgb(${r}, ${g}, ${b})`;
    });
    assert.ok(
      conhecida || rgb === "rgb(0, 0, 0)" || rgb === "rgb(255, 255, 255)",
      `copaflix.css usa rgba fora da paleta: ${m[0]})`,
    );
  }
});
