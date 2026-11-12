import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { criarMonitorDeLinks, JANELA_DA_ABERTURA_MS, type LinkMonitorado } from "../src/lib/monitor-links";

const ler = (arquivo: string) => readFileSync(arquivo, "utf8");

const links: LinkMonitorado[] = [
  { id: "intranet-A", rotulo: "Livro A", url: "https://exemplo.test/pontoa.php", intervaloMs: 4_500, ativo: true, leitor: "app" },
  { id: "navios-atracados", rotulo: "Navios", url: "https://exemplo.test/navios", intervaloMs: 300_000, ativo: true, leitor: "navios" },
  { id: "intranet-B", rotulo: "Livro B", url: "https://exemplo.test/pontob.php", intervaloMs: 4_500, ativo: false, leitor: "app" },
];

/** `fetch` de mentira: registra as URLs e responde conforme o mapa. */
function buscarFalso(respostas: Record<string, () => Response | Promise<Response>>) {
  const chamadas: { url: string; metodo: string }[] = [];
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    chamadas.push({ url, metodo: init?.method ?? "GET" });
    const responder = respostas[url];
    if (!responder) throw new Error(`URL não prevista no teste: ${url}`);
    return responder();
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const ok206 = () => new Response(null, { status: 206 });
const erro500 = () => new Response(null, { status: 500 });

test("abertura verifica TODOS os links ativos na hora, sem esperar intervalo", async () => {
  const { buscar, chamadas } = buscarFalso({
    "https://exemplo.test/pontoa.php": ok206,
    "https://exemplo.test/navios": ok206,
    "https://exemplo.test/pontob.php": ok206,
  });
  const monitor = criarMonitorDeLinks({ links: () => links, buscar, esperaEntreTentativasMs: 0 });

  const resumo = await monitor.abrirSessao();

  assert.ok(resumo, "a abertura precisa devolver a rodada");
  assert.equal(resumo.verificados, 2, "só os links ativos entram");
  assert.equal(resumo.ok, 2);
  assert.equal(resumo.falhas, 0);
  assert.deepEqual(
    chamadas.map((c) => c.url).sort(),
    ["https://exemplo.test/navios", "https://exemplo.test/pontoa.php"],
    "verificou os ativos e não tocou no inativo",
  );
  assert.ok(chamadas.every((c) => c.metodo === "GET"), "verificação por GET com Range de 1 byte");

  const retrato = monitor.resultados().find((r) => r.id === "intranet-A");
  assert.ok(retrato?.ultimaConsultaEm, "registra o horário da consulta");
  assert.equal(retrato?.httpStatus, 206, "registra o resultado");
  assert.equal(retrato?.ok, true);
});

test("falha de um link não derruba nem marca os outros como offline", async () => {
  const { buscar } = buscarFalso({
    "https://exemplo.test/pontoa.php": () => { throw new Error("ECONNRESET"); },
    "https://exemplo.test/navios": ok206,
    "https://exemplo.test/pontob.php": ok206,
  });
  const monitor = criarMonitorDeLinks({ links: () => links, buscar, esperaEntreTentativasMs: 0 });

  const resumo = await monitor.abrirSessao();
  assert.ok(resumo);
  assert.deepEqual(resumo.foraDoAr, ["intranet-A"]);
  assert.equal(resumo.ok, 1, "o outro link continua no ar");
  assert.equal(resumo.falhas, 1);

  const porId = new Map(monitor.resultados().map((r) => [r.id, r]));
  assert.equal(porId.get("intranet-A")?.ok, false);
  assert.match(String(porId.get("intranet-A")?.erro), /ECONNRESET/);
  assert.equal(porId.get("navios-atracados")?.ok, true);
});

test("link que falha e volta é tentado de novo e fica 'no ar'", async () => {
  let tentativas = 0;
  const { buscar, chamadas } = buscarFalso({
    "https://exemplo.test/pontoa.php": () => {
      tentativas += 1;
      return tentativas === 1 ? erro500() : ok206();
    },
    "https://exemplo.test/navios": ok206,
  });
  const monitor = criarMonitorDeLinks({ links: () => links, buscar, esperaEntreTentativasMs: 0 });

  const primeiro = await monitor.abrirSessao();
  assert.equal(primeiro?.falhas, 0, "a nova tentativa automática salvou o link");
  const retrato = monitor.resultados().find((r) => r.id === "intranet-A");
  assert.equal(retrato?.ok, true);
  assert.equal(retrato?.tentativas, 2, "duas tentativas: a primeira deu HTTP 500");
  assert.equal(chamadas.filter((c) => c.url.endsWith("pontoa.php")).length, 2);
});

test("sem consulta duplicada: duas aberturas seguidas não repetem as consultas", async () => {
  const { buscar, chamadas } = buscarFalso({
    "https://exemplo.test/pontoa.php": ok206,
    "https://exemplo.test/navios": ok206,
  });
  let relogio = 1_000_000;
  const monitor = criarMonitorDeLinks({
    links: () => links,
    buscar,
    agora: () => relogio,
    esperaEntreTentativasMs: 0,
  });

  const [a, b] = await Promise.all([monitor.abrirSessao(), monitor.abrirSessao()]);
  assert.ok(a && b);
  assert.equal(chamadas.length, 2, "uma consulta por link, mesmo com duas aberturas juntas");

  relogio += JANELA_DA_ABERTURA_MS - 1;
  assert.equal(await monitor.abrirSessao(), null, "dentro da janela a rodada é reaproveitada");
  assert.equal(chamadas.length, 2);

  relogio += 2;
  const outra = await monitor.abrirSessao();
  assert.ok(outra, "passada a janela, a abertura verifica de novo");
  assert.equal(chamadas.length, 4);
});

test("verificação em curso não é repetida (sem sobreposição)", async () => {
  const porteiro: { liberar: (() => void) | null } = { liberar: null };
  const { buscar, chamadas } = buscarFalso({
    "https://exemplo.test/pontoa.php": () =>
      new Promise<Response>((resolve) => {
        porteiro.liberar = () => resolve(ok206());
      }),
    "https://exemplo.test/navios": ok206,
  });
  const monitor = criarMonitorDeLinks({ links: () => links, buscar, esperaEntreTentativasMs: 0 });

  const primeira = monitor.verificarTodos("teste");
  await new Promise((r) => setTimeout(r, 10));
  const segunda = monitor.verificarTodos("teste-de-novo");
  assert.equal(primeira, segunda, "a segunda chamada reaproveita a rodada em curso");
  porteiro.liberar?.();
  await primeira;
  assert.equal(chamadas.filter((c) => c.url.endsWith("pontoa.php")).length, 1);
});

test("a abertura do app está ligada na rota e no aplicativo", () => {
  const rota = ler("src/app/api/estado/route.ts");
  assert.match(rota, /searchParams\.get\("abertura"\) === "1"/);
  assert.ok(rota.includes("acordarMonitoramentos"), "a rota precisa acordar os monitoramentos");
  assert.ok(rota.includes("verificarLinksNaAbertura"), "a rota precisa verificar os links na abertura");
  assert.ok(rota.includes("monitorarStatusEmSegundoPlano({ forcar: true })"));
  assert.ok(rota.includes("atualizarFilaEntreCiclos({ forcar: true })"));
  assert.ok(rota.includes("verificarNaviosFertilizantes({ forcar: true })"));
  assert.ok(rota.includes("if (acordar) await acordar"), "a função precisa ficar viva até a rodada terminar");

  const app = ler("src/components/MonitorApp.tsx");
  assert.ok(app.includes('?abertura=1'), "o app avisa o servidor quando abre");
  assert.ok(app.includes("buscarEstado(true)"), "a resposta da abertura é usada na tela");
  assert.match(app, /if \(perfilPronto\) pedirVerificacaoDaAbertura\(\)/);

  // O monitor de links não escreve intervalo nenhum: só lê os já configurados.
  const fonte = ler("src/lib/monitor-links.ts");
  assert.ok(!/intervalo\w*Ms\s*=\s*\d/.test(fonte), "nenhum intervalo é redefinido aqui");
  assert.ok(fonte.includes("intervaloNaviosMs()") && fonte.includes("intervaloStatusMs()"));
});
