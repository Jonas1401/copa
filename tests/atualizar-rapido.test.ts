import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import nextConfig, { carimboDaPublicacao } from "../next.config";
import { GET as versaoNoAr } from "../src/app/api/versao/route";
import {
  ASSENTAR_AO_VOLTAR_MS,
  CHAVE_DA_RECARGA,
  ESPERA_PARA_RECARREGAR_DE_NOVO_MS,
  INTERVALO_DO_VIGIA_MS,
  MAXIMO_DE_RECARGAS_POR_VERSAO,
  PARADA_PARA_RECARREGAR_MS,
  PAUSA_DO_VIGIA_AO_VOLTAR_MS,
  PAUSA_ENTRE_VOLTAS_MS,
  PRAZO_DA_VERSAO_MS,
  SELETOR_DE_TELA_OCUPADA,
  anotarRecarga,
  deveAtualizarAoVoltar,
  lerRecarga,
  ligarAoVoltarParaATela,
  ligarVigiaDeVersao,
  podeRecarregar,
  respostaAindaVale,
  versaoNova,
} from "../src/lib/atualizacao-da-tela";

/**
 * ATUALIZAR MAIS RÁPIDO — o que mantém os dados e a versão do app em dia.
 *
 *   1. A fila do portal é relida ENTRE as olhadas do Status quando há app
 *      aberto (o `/api/estado` chama `atualizarFilaEntreCiclos` depois da
 *      resposta). O comportamento, de ponta a ponta, está em
 *      `portal-fila-entre-ciclos-cron.test.ts`; aqui fica o lugar da chamada.
 *   2. A tela pede o estado na hora em que volta a aparecer, e uma resposta
 *      atrasada nunca passa por cima de uma mais nova.
 *   3. Publicação nova: a tela que ficou aberta com o código antigo se
 *      recarrega sozinha, num momento em que não atrapalha.
 */
const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const numero = (fonte: string, nome: string) => {
  const m = fonte.match(new RegExp(`const ${nome} = ([0-9_]+)`));
  assert.ok(m, `não achei ${nome}`);
  return Number(m[1].replace(/_/g, ""));
};

/* ------------------------------------------------------------- 1. a fila */

test("o /api/estado relê a fila entre ciclos depois da resposta, por último e só com tempo de sobra", () => {
  const rota = ler("src/app/api/estado/route.ts");
  const segundoPlano = rota.slice(rota.indexOf("after(async () => {"), rota.indexOf("return NextResponse.json(estado"));
  assert.ok(segundoPlano.length > 200, "o bloco after() da rota");
  const status = segundoPlano.indexOf("await monitorarStatusEmSegundoPlano()");
  const fila = segundoPlano.indexOf("await atualizarFilaEntreCiclos({ livrosDoPedido })");
  assert.ok(status > 0 && fila > status, "a fila entre ciclos vem DEPOIS da olhada do Status (é o Status que avisa a saída)");
  assert.match(
    segundoPlano,
    /if \(Date\.now\(\) - inicioDoSegundoPlano < PRAZO_PARA_COMECAR_A_FILA_MS\) await atualizarFilaEntreCiclos\(\{ livrosDoPedido \}\)\.catch\(\(\) => null\);/,
    "só começa com tempo de sobra, e uma falha dela nunca derruba o resto",
  );
  assert.match(segundoPlano, /const inicioDoSegundoPlano = Date\.now\(\);/);
  // A resposta ao app não espera a leitura da fila: fora da ABERTURA (que roda no
  // after), a chamada só existe dentro do after().
  const semAbertura = rota.replace(/async function acordarMonitoramentos\(\)[\s\S]*?\n}\n/, "");
  assert.equal(semAbertura.split("atualizarFilaEntreCiclos(").length - 1, 1);
  assert.match(
    rota,
    /async function acordarMonitoramentos\(\)[\s\S]*atualizarFilaEntreCiclos\(\{ forcar: true \}\)/,
    "a abertura força UMA rodada da fila, sem alterar o intervalo",
  );
  // Com ela vão os livros dos pontos de quem está com o app aberto (só os dele: o visitante não pede livro nenhum).
  assert.match(rota, /const livrosDoPedido = \[\.\.\.new Set\(estado\.pontos\.map\(\(p\) => p\.livro\)\)\];/);

  // A conta do tempo: começa até 35 s, e a função tem 60 s. Nem com o prazo cheio de uma leitura da
  // fila (14 s) estouraria; a leitura entre ciclos usa um prazo próprio, mais curto (6 s), para não
  // segurar a sessão que a olhada do Status também usa.
  const copadubo = ler("src/lib/portal-copadubo.ts");
  const comecaAte = numero(rota, "PRAZO_PARA_COMECAR_A_FILA_MS");
  const leituraAte = numero(copadubo, "PRAZO_FILA_MS");
  const funcao = Number(rota.match(/export const maxDuration = (\d+);/)?.[1]) * 1000;
  assert.equal(comecaAte, 35_000);
  assert.equal(leituraAte, 14_000);
  assert.equal(funcao, 60_000);
  assert.ok(comecaAte + leituraAte + 10_000 <= funcao, "sobram pelo menos 10 s de folga");
  assert.equal(numero(copadubo, "PRAZO_FILA_ENTRE_CICLOS_MS"), 6_000);
  assert.ok(
    copadubo.includes("return lerFilaComSessao(structuredClone(sessao), { buscar: opcoes.buscar, livros: opcoes.livros, prazoMs: PRAZO_FILA_ENTRE_CICLOS_MS });"),
    "a leitura sem gravação usa uma cópia da sessão e o prazo curto",
  );
});

/* ------------------------------------------- de mentira: tela, relógio, rede */

type Ouvinte = (ev: { target?: unknown; persisted?: boolean; type?: string }) => void;

/** Um alvo de eventos de mentira (faz as vezes do `document` e do `window`). */
function alvoDeMentira() {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  return {
    addEventListener(tipo: string, f: Ouvinte) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
      ouvintes.get(tipo)!.add(f);
    },
    removeEventListener(tipo: string, f: Ouvinte) {
      ouvintes.get(tipo)?.delete(f);
    },
    emitir(tipo: string, ev: { target?: unknown; persisted?: boolean } = {}) {
      for (const f of [...(ouvintes.get(tipo) ?? [])]) f({ type: tipo, ...ev });
    },
    ligados: () => [...ouvintes.entries()].filter(([, o]) => o.size > 0).map(([tipo]) => tipo).sort(),
  };
}

const esvaziarPromessas = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Um relógio de mentira: o tempo só anda quando o teste manda. */
function relogioDeMentira(inicio = 1_700_000_000_000) {
  let agora = inicio;
  let serie = 0;
  const tarefas = new Map<number, { quando: number; f: () => void; cada: number | null }>();
  return {
    agora: () => agora,
    temporizadores: {
      setTimeout: (f: () => void, ms: number) => (tarefas.set(++serie, { quando: agora + ms, f, cada: null }), serie),
      clearTimeout: (id: unknown) => void tarefas.delete(id as number),
      setInterval: (f: () => void, ms: number) => (tarefas.set(++serie, { quando: agora + ms, f, cada: ms }), serie),
      clearInterval: (id: unknown) => void tarefas.delete(id as number),
    },
    async avancar(ms: number) {
      const fim = agora + ms;
      await esvaziarPromessas();
      for (;;) {
        const proxima = [...tarefas.entries()].filter(([, t]) => t.quando <= fim).sort((x, y) => x[1].quando - y[1].quando || x[0] - y[0])[0];
        if (!proxima) break;
        const [id, t] = proxima;
        agora = t.quando;
        if (t.cada === null) tarefas.delete(id);
        else t.quando += t.cada;
        t.f();
        await esvaziarPromessas();
      }
      agora = fim;
      await esvaziarPromessas();
    },
    pendentes: () => tarefas.size,
  };
}

const MINUTO = 60_000;

/** Monta o vigia de versão numa tela de mentira. A tela é a "v1"; o servidor responde o que o teste mandar. */
function montarVigia(opcoes: { versao?: string; caminho?: string } = {}) {
  const relogio = relogioDeMentira();
  const alvoDoc = alvoDeMentira();
  const janela = alvoDeMentira();
  const tela = {
    visibilityState: "visible",
    activeElement: null as unknown,
    midias: [] as { paused: boolean }[],
    janelaPorCima: false,
    seletores: [] as string[],
  };
  // (Sem Object.assign: ele copiaria o VALOR dos getters, e a tela de mentira ficaria parada no tempo.)
  const documento = {
    addEventListener: alvoDoc.addEventListener,
    removeEventListener: alvoDoc.removeEventListener,
    emitir: alvoDoc.emitir,
    ligados: alvoDoc.ligados,
    get visibilityState() {
      return tela.visibilityState;
    },
    get activeElement() {
      return tela.activeElement;
    },
    querySelector(seletor: string) {
      tela.seletores.push(seletor);
      return tela.janelaPorCima ? {} : null;
    },
    querySelectorAll(seletor: string) {
      tela.seletores.push(seletor);
      return tela.midias;
    },
  };
  const servidor = {
    /** O que `/api/versao` responde. */
    versao: "v1" as unknown,
    ok: true,
    /** Quanto a resposta demora (ms do relógio de mentira). */
    demora: 150,
    caiu: false,
    /** Responde mesmo depois de o pedido ser cancelado (um fetch de verdade falharia). */
    ignoraCancelamento: false,
  };
  const pedidos: { endereco: string; cache: string }[] = [];
  const sinais: AbortSignal[] = [];
  const guardado = new Map<string, string>();
  const aba = { bloqueada: false, naoLe: false, naoGrava: false };
  let recargas = 0;
  const desligar = ligarVigiaDeVersao({
    versao: opcoes.versao ?? "v1",
    documento,
    janela,
    agora: relogio.agora,
    temporizadores: relogio.temporizadores,
    caminho: () => opcoes.caminho ?? "/",
    recarregar: () => {
      recargas += 1;
    },
    armazenamento: () => {
      if (aba.bloqueada) throw new Error("armazenamento bloqueado");
      return {
        getItem: (chave: string) => {
          if (aba.naoLe) throw new Error("leitura bloqueada");
          return guardado.get(chave) ?? null;
        },
        setItem: (chave: string, valor: string) => {
          if (aba.naoGrava) throw new Error("sem espaço");
          guardado.set(chave, valor);
        },
      };
    },
    buscar: (endereco, o) => {
      pedidos.push({ endereco, cache: o.cache });
      sinais.push(o.signal);
      const { versao, ok, demora, caiu, ignoraCancelamento } = servidor;
      return new Promise((resolver, rejeitar) => {
        // Como o fetch de verdade: se o pedido é cancelado antes da resposta, ele falha.
        if (!ignoraCancelamento) o.signal.addEventListener("abort", () => rejeitar(new Error("cancelado")));
        relogio.temporizadores.setTimeout(() => {
          if (caiu) rejeitar(new Error("sem rede"));
          else resolver({ ok, json: async () => ({ versao }) });
        }, demora);
      });
    },
  });
  return {
    relogio,
    documento,
    janela,
    tela,
    servidor,
    pedidos,
    sinais,
    guardado,
    aba,
    desligar,
    recargas: () => recargas,
    anotado: () => lerRecarga(guardado.get(CHAVE_DA_RECARGA)),
    /** A pessoa sai do app e volta `foraMs` depois. */
    async sairEVoltar(foraMs = 2 * MINUTO) {
      tela.visibilityState = "hidden";
      alvoDoc.emitir("visibilitychange");
      await relogio.avancar(foraMs);
      tela.visibilityState = "visible";
      alvoDoc.emitir("visibilitychange");
      await esvaziarPromessas();
    },
  };
}

/* ------------------------------------------------- 2. voltar para a tela */

test("voltou para a tela: pede os dados na hora — uma vez só, e só com a tela à vista", () => {
  assert.equal(PAUSA_ENTRE_VOLTAS_MS, 1_000);
  assert.equal(deveAtualizarAoVoltar("visible", 10_000, 0), true);
  assert.equal(deveAtualizarAoVoltar("hidden", 10_000, 0), false);
  assert.equal(deveAtualizarAoVoltar("prerender", 10_000, 0), false);
  assert.equal(deveAtualizarAoVoltar("visible", 10_000, 9_001), false, "acabou de pedir (outro evento da mesma volta)");
  assert.equal(deveAtualizarAoVoltar("visible", 10_000, 9_000), true);

  let agora = 5_000;
  let vezes = 0;
  const documento = Object.assign(alvoDeMentira(), { visibilityState: "hidden" });
  const janela = alvoDeMentira();
  const desligar = ligarAoVoltarParaATela(documento, janela, () => void (vezes += 1), () => agora);
  assert.deepEqual(documento.ligados(), ["visibilitychange"]);
  assert.deepEqual(janela.ligados(), ["online", "pageshow"]);

  documento.emitir("visibilitychange");
  assert.equal(vezes, 0, "foi para o segundo plano: nada");
  janela.emitir("online");
  assert.equal(vezes, 0, "a rede voltou com a tela escondida: nada (pede quando a tela aparecer)");

  documento.visibilityState = "visible";
  documento.emitir("visibilitychange");
  assert.equal(vezes, 1, "voltou: pede já, na primeira vez (sem esperar nada)");
  janela.emitir("online");
  janela.emitir("pageshow", { persisted: true });
  assert.equal(vezes, 1, "os outros avisos da mesma volta não repetem o pedido");

  agora += 999;
  janela.emitir("online");
  assert.equal(vezes, 1);
  agora += 1;
  janela.emitir("online");
  assert.equal(vezes, 2, "a rede voltou (1 s depois): pede de novo");

  agora += 5_000;
  janela.emitir("pageshow", { persisted: false });
  assert.equal(vezes, 2, "abertura comum da página não é “voltar”");
  janela.emitir("pageshow", { persisted: true });
  assert.equal(vezes, 3, "voltou do cache de navegação do navegador: pede");

  desligar();
  assert.deepEqual([documento.ligados(), janela.ligados()], [[], []], "ao desmontar, nenhum ouvinte fica para trás");
  agora += 60_000;
  documento.emitir("visibilitychange");
  assert.equal(vezes, 3);
});

test("uma resposta atrasada nunca passa por cima de uma mais nova", () => {
  assert.equal(respostaAindaVale(1, 0), true, "a primeira resposta entra");
  assert.equal(respostaAindaVale(7, 6), true);
  assert.equal(respostaAindaVale(6, 7), false, "o pedido 6 chegou depois do 7: fica de fora");
  assert.equal(respostaAindaVale(7, 7), false);

  const tela = ler("src/components/MonitorApp.tsx");
  const buscar = tela.slice(
    tela.indexOf("const buscarEstado = useCallback(async (abertura = false) => {"),
    tela.indexOf("const entrarEstadoDaAcao = useCallback("),
  );
  assert.ok(buscar.length > 300 && buscar.length < 1500, "o trecho do buscarEstado");
  const numero = buscar.indexOf("const pedido = ++pedidoDeEstado.current;");
  const pedidoNaRede = buscar.indexOf('await fetch(`/api/estado${abertura ? "?abertura=1" : ""}`');
  const confere = buscar.indexOf("if (!respostaAindaVale(pedido, estadoQueEntrou.current)) return;");
  const marca = buscar.indexOf("estadoQueEntrou.current = pedido;");
  const entra = buscar.indexOf("setEstado(novo);");
  assert.ok(numero > 0 && pedidoNaRede > numero, "o número é tirado ANTES de o pedido sair");
  assert.ok(confere > pedidoNaRede && marca > confere && entra > marca, "confere, marca e só então entra na tela");
  assert.equal(buscar.split("setEstado(").length - 1, 1, "um só caminho para a resposta entrar");
  assert.match(buscar, /if \(\(motoristaRef\.current\?\.id \?\? 0\) !== id\) return;/, "resposta de outro motorista continua de fora");

  // O estado que vem na resposta de uma ação (reler, corrigir, remover, cadastrar) entra já e
  // deixa velhos os pedidos que estavam a caminho.
  const acao = tela.slice(tela.indexOf("const entrarEstadoDaAcao = useCallback("), tela.indexOf("useAoVoltarParaATela(() => {"));
  assert.match(acao, /estadoQueEntrou\.current = \+\+pedidoDeEstado\.current;\s+setEstado\(novo\);/);
  assert.equal(tela.split("entrarEstadoDaAcao(").length - 1, 4, "as 4 ações usam o mesmo caminho");
  // Fora desses dois caminhos só resta a limpeza de quem saiu da conta (não é resposta do servidor).
  assert.equal(tela.split("setEstado(").length - 1, 3);
  assert.match(tela, /setEstado\(\(e\) => motoristaRef\.current \? e : \{ \.\.\.e, pontos: \[\], eventos: \[\] \}\);/);
});

test("a tela principal pede tudo de novo ao voltar: estado, contagem do chat, motoristas e navios", () => {
  const tela = ler("src/components/MonitorApp.tsx");
  const m = tela.match(/useAoVoltarParaATela\(\(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(m, "a chamada do useAoVoltarParaATela");
  for (const linha of ["void buscarEstado();", "void carregarContagem();", "void carregarNaviosAtracados();", "setVoltas((n) => n + 1);"]) {
    assert.ok(m[1].includes(linha), `ao voltar: ${linha}`);
  }
  // A contagem do chat refaz na hora porque o efeito dela depende de `voltas`.
  assert.match(tela, /const t = setInterval\(\(\) => void contar\(\), 20_000\);\s+return \(\) => clearInterval\(t\);\s+\}, \[chatAberto, motorista\?\.id, voltas\]\);/);
  // O ciclo normal continua igual: primeira busca cedo, depois a cada 5 s.
  assert.match(tela, /const primeira = setTimeout\(\(\) => void buscarEstado\(\), 2200\);\s+timer\.current = setInterval\(\(\) => void buscarEstado\(\), 5000\);/);

  const gancho = ler("src/components/useAoVoltarParaATela.ts");
  assert.match(gancho, /useEffect\(\(\) => ligarAoVoltarParaATela\(document, window, \(\) => atual\.current\(\)\), \[\]\);/);
  assert.match(gancho, /useEffect\(\(\) => \{\s+atual\.current = acao;\s+\}\);/, "sempre a ação mais recente, sem religar os ouvintes");
});

/* ------------------------------------------------- 3. versão nova publicada */

test("o carimbo da publicação: commit + publicação na Vercel, igual no celular e no servidor", async () => {
  const sha = "b14a5002c778bc1b96be0684d8f4354682b28cfc";
  assert.equal(carimboDaPublicacao({ VERCEL_GIT_COMMIT_SHA: sha, VERCEL_DEPLOYMENT_ID: "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3" }), "b14a5002c778-Gp7nwbuh3".replace("Gp7nwbuh3", "p7nwbuh3"));
  assert.equal(carimboDaPublicacao({ VERCEL_GIT_COMMIT_SHA: sha }), "b14a5002c778", "sem o número da publicação: só o commit");
  assert.equal(carimboDaPublicacao({ VERCEL_DEPLOYMENT_ID: "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3" }), "p7nwbuh3", "sem o commit: só a publicação");
  assert.equal(carimboDaPublicacao({ VERCEL_DEPLOYMENT_ID: "dpl_abc" }), "abc", "o prefixo dpl_ sai mesmo num número curto");
  assert.equal(carimboDaPublicacao({}), "", "fora da Vercel: vazio (o vigia não liga)");
  assert.equal(carimboDaPublicacao({ VERSAO_APP: " teste-1 ", VERCEL_GIT_COMMIT_SHA: sha }), "teste-1", "VERSAO_APP manda");
  assert.equal(carimboDaPublicacao({ VERSAO_APP: "   ", VERCEL_GIT_COMMIT_SHA: sha }), "b14a5002c778", "VERSAO_APP em branco não conta");
  assert.equal(carimboDaPublicacao({ VERSAO_APP: 'a"b<c>/d e' }), "abcde", "só letras, números, ponto, traço e sublinhado");
  assert.equal(carimboDaPublicacao({ VERSAO_APP: "x".repeat(100) }).length, 40);
  // Duas publicações do mesmo commit têm carimbos diferentes; a mesma publicação, sempre o mesmo.
  assert.notEqual(
    carimboDaPublicacao({ VERCEL_GIT_COMMIT_SHA: sha, VERCEL_DEPLOYMENT_ID: "dpl_AAAAAAAAAAAA1111" }),
    carimboDaPublicacao({ VERCEL_GIT_COMMIT_SHA: sha, VERCEL_DEPLOYMENT_ID: "dpl_AAAAAAAAAAAA2222" }),
  );

  // Entra no código na compilação…
  assert.equal(typeof nextConfig.env?.NEXT_PUBLIC_VERSAO_APP, "string");
  assert.match(ler("next.config.ts"), /env: \{ NEXT_PUBLIC_VERSAO_APP: carimboDaPublicacao\(process\.env\) \},/);
  // …e é lido com o nome inteiro (é assim que o compilador troca pelo valor no código do celular).
  assert.match(ler("src/lib/versao-app.ts"), /export const VERSAO_DO_APP: string = \(process\.env\.NEXT_PUBLIC_VERSAO_APP \?\? ""\)\.trim\(\);/);

  // /api/versao: resposta fixa por publicação, nunca guardada pelo navegador.
  const rota = ler("src/app/api/versao/route.ts");
  assert.match(rota, /export const dynamic = "force-static";/);
  assert.match(rota, /return Response\.json\(\{ versao: VERSAO_DO_APP \|\| null \}\);/);
  const resposta = versaoNoAr();
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { versao: null }, "nos testes não há carimbo: responde null (e a tela ignora)");
  const cabecalhos = await nextConfig.headers!();
  assert.deepEqual(
    cabecalhos.find((c) => c.source === "/api/versao")?.headers,
    [{ key: "Cache-Control", value: "no-store, max-age=0" }],
  );
  // As imagens e os ícones continuam guardados por 7 dias.
  assert.equal(cabecalhos.filter((c) => c.headers[0].value.startsWith("public, max-age=604800")).length, 2);

  // O vigia está em todas as páginas (layout raiz), com os objetos de verdade do navegador.
  const layout = ler("src/app/layout.tsx");
  assert.match(layout, /<body>\s+\{children\}\s+\{\/\*[^*]*\*\/\}\s+<VigiaDeVersao \/>\s+<\/body>/);
  const vigia = ler("src/components/VigiaDeVersao.tsx");
  for (const trecho of [
    "versao: VERSAO_DO_APP,",
    "documento: document,",
    "janela: window,",
    "buscar: (endereco, opcoes) => fetch(endereco, opcoes),",
    "armazenamento: () => window.sessionStorage,",
    "caminho: () => window.location.pathname,",
    "recarregar: () => window.location.reload(),",
  ]) {
    assert.ok(vigia.includes(trecho), trecho);
  }
});

test("versaoNova, lerRecarga e anotarRecarga", () => {
  assert.equal(versaoNova("v1", "v2"), "v2");
  assert.equal(versaoNova("v1", " v2 "), "v2");
  assert.equal(versaoNova("v1", "v1"), null, "a mesma versão");
  assert.equal(versaoNova("v1", " v1 "), null);
  assert.equal(versaoNova("", "v2"), null, "a tela não sabe a própria versão: vigia desligado");
  for (const lixo of [null, undefined, 2, {}, [], "", "   ", "x".repeat(81)]) assert.equal(versaoNova("v1", lixo), null, `resposta estranha: ${JSON.stringify(lixo)}`);
  assert.equal(versaoNova("v1", "x".repeat(80)), "x".repeat(80));

  assert.equal(lerRecarga(null), null);
  assert.equal(lerRecarga(""), null);
  assert.equal(lerRecarga("{quebrado"), null);
  assert.equal(lerRecarga("null"), null);
  assert.equal(lerRecarga('{"versao":"","em":5}'), null);
  assert.equal(lerRecarga('{"versao":"v2"}'), null);
  assert.equal(lerRecarga('{"versao":"v2","em":"ontem"}'), null);
  assert.deepEqual(lerRecarga('{"versao":"v2","em":5}'), { versao: "v2", em: 5, vezes: 1 }, "anotação sem contagem vale por uma");
  assert.deepEqual(lerRecarga('{"versao":"v2","em":5,"vezes":2}'), { versao: "v2", em: 5, vezes: 2 });
  assert.deepEqual(lerRecarga('{"versao":"v2","em":5,"vezes":0}'), { versao: "v2", em: 5, vezes: 1 });
  assert.deepEqual(lerRecarga('{"versao":"v2","em":5,"vezes":2.9}'), { versao: "v2", em: 5, vezes: 2 });

  assert.deepEqual(anotarRecarga("v2", null, 9), { versao: "v2", em: 9, vezes: 1 });
  assert.deepEqual(anotarRecarga("v2", { versao: "v2", em: 1, vezes: 1 }, 9), { versao: "v2", em: 9, vezes: 2 }, "a mesma versão de novo: conta");
  assert.deepEqual(anotarRecarga("v3", { versao: "v2", em: 1, vezes: 2 }, 9), { versao: "v3", em: 9, vezes: 1 }, "outra versão: recomeça");
});

test("podeRecarregar: só num momento em que não atrapalha", () => {
  const base = {
    nova: "v2" as string | null,
    momento: "voltou" as const,
    aVista: true,
    digitou: false,
    campoEmFoco: false,
    midiaTocando: false,
    ocupada: false,
    paradaHaMs: null as number | null,
    tocouDesdeQueVoltou: false,
    caminho: "/",
    ultima: null,
    agora: 1_000_000,
    podeAnotar: true,
  };
  assert.equal(podeRecarregar(base), true, "voltou, não tocou em nada, nada no caminho");
  assert.equal(podeRecarregar({ ...base, nova: null }), false, "sem versão nova");
  assert.equal(podeRecarregar({ ...base, aVista: false }), false, "nunca em segundo plano");
  assert.equal(podeRecarregar({ ...base, podeAnotar: false }), false, "sem conseguir anotar, não há como evitar o laço");
  assert.equal(podeRecarregar({ ...base, digitou: true }), false, "algo digitado ou escolhido");
  assert.equal(podeRecarregar({ ...base, campoEmFoco: true }), false, "campo em foco");
  assert.equal(podeRecarregar({ ...base, midiaTocando: true }), false, "áudio tocando");
  assert.equal(podeRecarregar({ ...base, ocupada: true }), false, "janela aberta por cima");
  assert.equal(podeRecarregar({ ...base, tocouDesdeQueVoltou: true }), false, "já tocou desde que voltou");
  assert.equal(podeRecarregar({ ...base, paradaHaMs: 10 }), true, "ao voltar, o que conta é não ter tocado DESDE a volta");

  for (const caminho of ["/admin", "/admin/", "/admin/motoristas", "/monitor", "/monitor/x"]) {
    assert.equal(podeRecarregar({ ...base, caminho }), false, `tela do administrador: ${caminho}`);
  }
  for (const caminho of ["/", "/divulgacao", "/consulta-ponto", "/administracao", "/monitoramento", "/navios/admin"]) {
    assert.equal(podeRecarregar({ ...base, caminho }), true, `tela comum: ${caminho}`);
  }

  // Tela à vista: só parada há 5 minutos (ou sem nenhum toque desde que abriu).
  const aVista = { ...base, momento: "a-vista" as const, tocouDesdeQueVoltou: true };
  assert.equal(PARADA_PARA_RECARREGAR_MS, 5 * MINUTO);
  assert.equal(podeRecarregar({ ...aVista, paradaHaMs: null }), true);
  assert.equal(podeRecarregar({ ...aVista, paradaHaMs: 5 * MINUTO }), true);
  assert.equal(podeRecarregar({ ...aVista, paradaHaMs: 5 * MINUTO - 1 }), false);
  assert.equal(podeRecarregar({ ...aVista, paradaHaMs: 0 }), false);

  // Nunca em laço: no máximo duas vezes atrás da mesma versão, com 10 minutos entre elas.
  assert.equal(ESPERA_PARA_RECARREGAR_DE_NOVO_MS, 10 * MINUTO);
  assert.equal(MAXIMO_DE_RECARGAS_POR_VERSAO, 2);
  const ha = (ms: number, vezes = 1, versao = "v2") => ({ ...base, ultima: { versao, em: base.agora - ms, vezes } });
  assert.equal(podeRecarregar(ha(0)), false, "acabou de recarregar atrás desta versão e ela continua “nova”");
  assert.equal(podeRecarregar(ha(10 * MINUTO - 1)), false);
  assert.equal(podeRecarregar(ha(10 * MINUTO)), true, "10 minutos depois: mais uma tentativa");
  assert.equal(podeRecarregar(ha(10 * MINUTO, 2)), false, "duas tentativas: chega");
  assert.equal(podeRecarregar(ha(24 * 60 * MINUTO, 2)), false);
  assert.equal(podeRecarregar(ha(0, 2, "v1b")), true, "a anotação é de OUTRA versão: não segura esta");
});

test("vigia de versão: quem volta para o app com versão nova no ar recebe a página nova — uma vez", async () => {
  assert.deepEqual([INTERVALO_DO_VIGIA_MS, PAUSA_DO_VIGIA_AO_VOLTAR_MS, PRAZO_DA_VERSAO_MS, ASSENTAR_AO_VOLTAR_MS], [5 * MINUTO, MINUTO, 4_000, 1_200]);
  assert.equal(SELETOR_DE_TELA_OCUPADA, '[aria-modal="true"], [data-sem-recarga]');

  // 0. Sem carimbo (compilação fora da Vercel): o vigia nem liga.
  const semCarimbo = montarVigia({ versao: "" });
  assert.deepEqual([semCarimbo.documento.ligados(), semCarimbo.janela.ligados(), semCarimbo.relogio.pendentes()], [[], [], 0]);
  semCarimbo.servidor.versao = "v2";
  await semCarimbo.sairEVoltar();
  await semCarimbo.relogio.avancar(30 * MINUTO);
  assert.deepEqual([semCarimbo.pedidos.length, semCarimbo.recargas()], [0, 0]);

  // 1. Mesma versão no ar: pergunta ao voltar e fica como está.
  const v = montarVigia();
  assert.deepEqual(v.documento.ligados(), ["change", "click", "input", "keydown", "pointerdown", "touchstart", "visibilitychange", "wheel"]);
  assert.deepEqual(v.janela.ligados(), ["pageshow"]);
  await v.sairEVoltar();
  assert.deepEqual(v.pedidos, [{ endereco: "/api/versao", cache: "no-store" }], "voltou: uma pergunta, sem usar o que o navegador guardou");
  await v.relogio.avancar(10_000);
  assert.equal(v.recargas(), 0);

  // 2. Saiu publicação nova enquanto o app estava em segundo plano.
  v.servidor.versao = "v2";
  await v.sairEVoltar();
  assert.equal(v.pedidos.length, 2);
  await v.relogio.avancar(ASSENTAR_AO_VOLTAR_MS - 1);
  assert.equal(v.recargas(), 0, "espera a tela assentar (a notificação tocada pode estar abrindo a conversa)");
  await v.relogio.avancar(1);
  assert.equal(v.recargas(), 1, "recarrega");
  assert.deepEqual(v.anotado(), { versao: "v2", em: v.relogio.agora(), vezes: 1 }, "e deixa anotado na aba atrás de qual versão foi");
  assert.deepEqual(v.tela.seletores, ["audio, video", SELETOR_DE_TELA_OCUPADA], "olhou se havia áudio tocando ou janela aberta por cima");

  // …e nunca duas vezes pela mesma tela (a página nova liga o próprio vigia).
  await v.sairEVoltar(3 * MINUTO);
  await v.relogio.avancar(30 * MINUTO);
  assert.equal(v.recargas(), 1);

  // 3. Volta pelo cache de navegação do navegador (botão voltar): vale como “voltou”.
  const c = montarVigia();
  c.servidor.versao = "v2";
  c.janela.emitir("pageshow", { persisted: false });
  await c.relogio.avancar(5_000);
  assert.deepEqual([c.pedidos.length, c.recargas()], [0, 0], "abertura comum da página: nada");
  c.janela.emitir("pageshow", { persisted: true });
  await c.relogio.avancar(ASSENTAR_AO_VOLTAR_MS);
  assert.deepEqual([c.pedidos.length, c.recargas()], [1, 1]);

  // 4. Voltas seguidas não viram uma pergunta por volta: no máximo uma por minuto.
  const s = montarVigia();
  await s.sairEVoltar();
  await s.sairEVoltar(10_000);
  await s.sairEVoltar(10_000);
  assert.equal(s.pedidos.length, 1);
  await s.sairEVoltar(40_000);
  assert.equal(s.pedidos.length, 2, "passou 1 minuto da última pergunta");

  // 5. Desligado com uma pergunta no ar (a página saiu): nenhum ouvinte fica para trás, a pergunta é
  //    cancelada e, mesmo com versão nova, não há recarga.
  s.servidor.versao = "v2";
  await s.sairEVoltar(2 * MINUTO);
  assert.equal(s.pedidos.length, 3, "a pergunta saiu");
  assert.equal(s.sinais[2].aborted, false);
  s.desligar();
  assert.equal(s.sinais[2].aborted, true, "a pergunta que estava no ar é cancelada");
  assert.deepEqual([s.documento.ligados(), s.janela.ligados()], [[], []]);
  await s.relogio.avancar(30 * MINUTO);
  assert.deepEqual([s.pedidos.length, s.recargas(), s.relogio.pendentes()], [3, 0, 0], "nada mais acontece, nenhum temporizador sobra");
});

test("vigia de versão: não recarrega em cima do que a pessoa está fazendo", async () => {
  /** Volta para o app com a “v2” no ar, depois de `preparar` mexer na tela. Devolve quantas recargas houve. */
  const voltar = async (preparar: (v: ReturnType<typeof montarVigia>) => void | Promise<void>, opcoes: { caminho?: string } = {}) => {
    const v = montarVigia(opcoes);
    v.servidor.versao = "v2";
    await preparar(v);
    await v.sairEVoltar();
    await v.relogio.avancar(ASSENTAR_AO_VOLTAR_MS + 5_000);
    assert.equal(v.pedidos.length, 1, "perguntou a versão");
    return v.recargas();
  };
  assert.equal(await voltar(() => {}), 1, "controle: sem nada no caminho, recarrega");

  assert.equal(await voltar((v) => v.documento.emitir("input")), 0, "digitou algo na página (mesmo antes de sair)");
  assert.equal(await voltar((v) => v.documento.emitir("change")), 0, "escolheu uma opção ou um arquivo");
  assert.equal(await voltar((v) => v.documento.emitir("click", { target: { tagName: "INPUT", type: "file" } })), 0, "abriu o seletor de arquivo (foto da conversa)");
  assert.equal(await voltar((v) => v.documento.emitir("click", { target: { tagName: "INPUT", type: "checkbox" } })), 1, "um toque comum antes de sair não segura");
  assert.equal(await voltar((v) => void (v.tela.activeElement = { tagName: "INPUT" })), 0, "campo de texto em foco");
  assert.equal(await voltar((v) => void (v.tela.activeElement = { tagName: "TEXTAREA" })), 0);
  assert.equal(await voltar((v) => void (v.tela.activeElement = { tagName: "SELECT" })), 0);
  assert.equal(await voltar((v) => void (v.tela.activeElement = { tagName: "DIV", isContentEditable: true })), 0, "área editável em foco");
  assert.equal(await voltar((v) => void (v.tela.activeElement = { tagName: "BUTTON" })), 1, "um botão em foco (o último tocado) não segura");
  assert.equal(await voltar((v) => void (v.tela.midias = [{ paused: true }, { paused: false }])), 0, "áudio da conversa tocando");
  assert.equal(await voltar((v) => void (v.tela.midias = [{ paused: true }])), 1, "áudio parado não segura");
  assert.equal(await voltar((v) => void (v.tela.janelaPorCima = true)), 0, "janela aberta por cima (a conversa, um alerta)");
  assert.equal(await voltar(() => {}, { caminho: "/admin" }), 0, "tela do administrador");
  assert.equal(await voltar((v) => void (v.aba.bloqueada = true)), 0, "a aba não deixa anotar: sem recarga");
  assert.equal(await voltar((v) => void (v.aba.naoLe = true)), 0, "não dá para ler a anotação anterior (mesmo podendo gravar): sem recarga, senão viraria laço");
  assert.equal(await voltar((v) => void (v.aba.naoGrava = true)), 0, "a anotação falhou: sem recarga");

  // Tocou na tela logo que voltou (antes de a tela assentar): fica para a próxima volta.
  const t = montarVigia();
  t.servidor.versao = "v2";
  await t.sairEVoltar();
  await t.relogio.avancar(600);
  t.documento.emitir("pointerdown");
  await t.relogio.avancar(10_000);
  assert.equal(t.recargas(), 0, "tocou: não recarrega debaixo do dedo");
  await t.sairEVoltar();
  await t.relogio.avancar(ASSENTAR_AO_VOLTAR_MS);
  assert.equal(t.recargas(), 1, "na volta seguinte, sem tocar: recarrega");

  // Saiu de novo antes de a tela assentar: nada de recarregar em segundo plano.
  const e = montarVigia();
  e.servidor.versao = "v2";
  await e.sairEVoltar();
  await e.relogio.avancar(500);
  e.tela.visibilityState = "hidden";
  e.documento.emitir("visibilitychange");
  await e.relogio.avancar(10 * MINUTO);
  assert.equal(e.recargas(), 0);
  // A resposta (lenta) chegou com a pessoa já fora do app: também não.
  const h = montarVigia();
  h.servidor.versao = "v2";
  h.servidor.demora = 3_000;
  await h.sairEVoltar();
  await h.relogio.avancar(2_000);
  h.tela.visibilityState = "hidden";
  h.documento.emitir("visibilitychange");
  await h.relogio.avancar(10 * MINUTO);
  assert.deepEqual([h.pedidos.length, h.recargas()], [1, 0]);
  h.servidor.demora = 150;
  h.tela.visibilityState = "visible";
  h.documento.emitir("visibilitychange");
  await h.relogio.avancar(ASSENTAR_AO_VOLTAR_MS);
  assert.deepEqual([h.pedidos.length, h.recargas()], [2, 1], "voltou de novo: pergunta outra vez e recarrega");
  // A conversa abriu enquanto a tela assentava (notificação tocada): fica.
  const n = montarVigia();
  n.servidor.versao = "v2";
  await n.sairEVoltar();
  await n.relogio.avancar(300);
  n.tela.janelaPorCima = true;
  await n.relogio.avancar(10_000);
  assert.equal(n.recargas(), 0);
});

test("vigia de versão: só recarrega com o servidor respondendo agora, e depressa", async () => {
  const comRede = async (mexer: (v: ReturnType<typeof montarVigia>) => void) => {
    const v = montarVigia();
    v.servidor.versao = "v2";
    mexer(v);
    await v.sairEVoltar();
    await v.relogio.avancar(20_000);
    return [v.pedidos.length, v.recargas()];
  };
  assert.deepEqual(await comRede(() => {}), [1, 1], "controle");
  assert.deepEqual(await comRede((v) => void (v.servidor.caiu = true)), [1, 0], "sem rede: fica como está (recarregar daria tela de erro)");
  assert.deepEqual(await comRede((v) => void (v.servidor.ok = false)), [1, 0], "o servidor respondeu com erro");
  assert.deepEqual(await comRede((v) => void (v.servidor.versao = null)), [1, 0], "resposta sem carimbo");
  assert.deepEqual(await comRede((v) => void (v.servidor.versao = { v: 2 })), [1, 0], "resposta estranha");
  assert.deepEqual(await comRede((v) => void (v.servidor.demora = PRAZO_DA_VERSAO_MS - 1)), [1, 1], "demorou, mas dentro do prazo");
  assert.deepEqual(await comRede((v) => void (v.servidor.demora = PRAZO_DA_VERSAO_MS + 1)), [1, 0], "rede lenta: a pergunta é cancelada no prazo e não há recarga");
  assert.deepEqual(
    await comRede((v) => {
      v.servidor.demora = PRAZO_DA_VERSAO_MS + 1;
      v.servidor.ignoraCancelamento = true;
    }),
    [1, 0],
    "a resposta chegou mesmo assim, depois do prazo: não vale",
  );

  // Uma pergunta por vez: a conferência do ciclo que cai com outra pergunta no ar não manda uma segunda.
  const l = montarVigia();
  l.servidor.versao = "v2";
  l.servidor.demora = 3_000;
  await l.relogio.avancar(INTERVALO_DO_VIGIA_MS - 2 * MINUTO - 1_000);
  await l.sairEVoltar(2 * MINUTO); // volta 1 s antes da conferência do ciclo; a resposta leva 3 s
  assert.equal(l.pedidos.length, 1, "a pergunta da volta saiu");
  await l.relogio.avancar(1_500); // o ciclo caiu aqui no meio
  assert.deepEqual([l.pedidos.length, l.recargas()], [1, 0], "o ciclo não mandou outra");
  await l.relogio.avancar(2_000);
  assert.deepEqual([l.pedidos.length, l.recargas()], [1, 1], "a resposta da volta chegou: recarrega");
});

test("vigia de versão: tela à vista o tempo todo — confere a cada 5 minutos e só recarrega parada", async () => {
  // Ninguém tocou desde que abriu: na primeira conferência com versão nova, recarrega.
  const RESPOSTA = 1_000; // tempo de sobra para a resposta do servidor (150 ms) chegar
  const v = montarVigia();
  await v.relogio.avancar(INTERVALO_DO_VIGIA_MS - 1);
  assert.equal(v.pedidos.length, 0, "antes dos 5 minutos não pergunta");
  await v.relogio.avancar(1 + RESPOSTA);
  assert.deepEqual([v.pedidos.length, v.recargas()], [1, 0], "mesma versão: só perguntou");
  v.servidor.versao = "v2";
  await v.relogio.avancar(INTERVALO_DO_VIGIA_MS);
  assert.deepEqual([v.pedidos.length, v.recargas()], [2, 1]);

  // Em uso: tocou há 1 minuto → espera; 5 minutos depois (parada há 6) → recarrega.
  const u = montarVigia();
  u.servidor.versao = "v2";
  await u.relogio.avancar(INTERVALO_DO_VIGIA_MS - MINUTO);
  u.documento.emitir("keydown");
  await u.relogio.avancar(MINUTO + RESPOSTA);
  assert.deepEqual([u.pedidos.length, u.recargas()], [1, 0], "em uso: não recarrega");
  await u.relogio.avancar(INTERVALO_DO_VIGIA_MS);
  assert.deepEqual([u.pedidos.length, u.recargas()], [2, 1], "parada há mais de 5 minutos: recarrega");

  // Em segundo plano o ciclo não pergunta nada.
  const f = montarVigia();
  f.servidor.versao = "v2";
  f.tela.visibilityState = "hidden";
  f.documento.emitir("visibilitychange");
  await f.relogio.avancar(60 * MINUTO);
  assert.deepEqual([f.pedidos.length, f.recargas()], [0, 0]);

  // Com a conversa aberta a tela não recarrega nem parada; fechou → na conferência seguinte, sim.
  const k = montarVigia();
  k.servidor.versao = "v2";
  k.tela.janelaPorCima = true;
  await k.relogio.avancar(3 * INTERVALO_DO_VIGIA_MS + RESPOSTA);
  assert.deepEqual([k.pedidos.length, k.recargas()], [3, 0]);
  k.tela.janelaPorCima = false;
  await k.relogio.avancar(INTERVALO_DO_VIGIA_MS);
  assert.equal(k.recargas(), 1);
});

test("vigia de versão: nunca em laço — a mesma aba recarrega no máximo 2 vezes atrás da mesma versão", async () => {
  // A página recarregou atrás da “v2” e continua com a “v1” (a recarga não trouxe a versão nova).
  const agora = relogioDeMentira().agora();
  const depoisDaRecarga = (anotacao: { versao: string; em: number; vezes: number }) => {
    const v = montarVigia();
    v.servidor.versao = "v2";
    v.guardado.set(CHAVE_DA_RECARGA, JSON.stringify(anotacao));
    return v;
  };

  const a = depoisDaRecarga({ versao: "v2", em: agora - 5_000, vezes: 1 });
  await a.sairEVoltar(2 * MINUTO);
  await a.relogio.avancar(ASSENTAR_AO_VOLTAR_MS + 1_000);
  assert.equal(a.recargas(), 0, "recarregou há 2 minutos atrás desta versão: não repete");
  await a.sairEVoltar(8 * MINUTO);
  await a.relogio.avancar(ASSENTAR_AO_VOLTAR_MS);
  assert.equal(a.recargas(), 1, "10 minutos depois: a segunda (e última) tentativa");
  assert.equal(a.anotado()?.vezes, 2);

  const b = depoisDaRecarga({ versao: "v2", em: agora - 60 * MINUTO, vezes: 2 });
  await b.sairEVoltar();
  await b.relogio.avancar(60 * MINUTO);
  assert.equal(b.recargas(), 0, "já tentou duas vezes: não tenta mais atrás desta versão");
  assert.ok(b.pedidos.length >= 12, "continua perguntando (para pegar a PRÓXIMA versão)");
  b.servidor.versao = "v3";
  await b.relogio.avancar(INTERVALO_DO_VIGIA_MS + 1_000);
  assert.equal(b.recargas(), 1, "saiu outra versão: recarrega");
  assert.deepEqual([b.anotado()?.versao, b.anotado()?.vezes], ["v3", 1]);

  const lixo = montarVigia();
  lixo.servidor.versao = "v2";
  lixo.guardado.set(CHAVE_DA_RECARGA, "{quebrado");
  await lixo.sairEVoltar();
  await lixo.relogio.avancar(ASSENTAR_AO_VOLTAR_MS);
  assert.equal(lixo.recargas(), 1, "anotação ilegível não trava a tela");
});
