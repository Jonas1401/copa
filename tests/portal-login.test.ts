import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entrarNoPortal,
  lerPortalDoMotorista,
  lerTelasDoMotorista,
  urlPortal,
  PORTAL_BASE,
} from "../src/lib/portal-copadubo";
import { SessaoPortal } from "../src/lib/portal-sessao";
import {
  BASE_FALSA,
  CPF_FALSO,
  PAGINA_404,
  SENHA_FALSA,
  criarPortalFalso,
  paginaLogin,
  telaFila,
  telaStatus,
} from "./portal-fixture";

/**
 * LOGIN no Portal do Motorista e leitura das telas — tudo contra um portal de
 * mentira (`tests/portal-fixture.ts`). Nenhum pedido sai da máquina.
 *
 * O defeito que estes testes travam: o app abria um endereço que não existe
 * (`/status.php`, 404), não via campo de senha, concluía “Login aceito” e
 * nunca enviava o CPF/senha. Toda saída do ponto acabava como “destino não
 * confirmado”.
 */

process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };

const html = (corpo: string, status = 200, cabecalhos: Record<string, string> = {}) =>
  new Response(corpo, { status, headers: { "content-type": "text/html; charset=UTF-8", ...cabecalhos } });

/** Nada do que volta para o banco/painel pode carregar CPF, senha ou cookie. */
function semSegredo(valor: unknown, onde: string) {
  const texto = JSON.stringify(valor);
  assert.ok(!texto.includes(SENHA_FALSA), `a senha vazou em ${onde}`);
  assert.ok(!texto.includes(CPF_FALSO), `o CPF vazou em ${onde}`);
  assert.ok(!/PHPSESSID|logado\d|visitante\d/.test(texto), `o cookie da sessão vazou em ${onde}`);
}

const STATUS_ESCALADO = telaStatus([
  {
    codigo: "A032",
    situacao: "ESCALADO",
    linhas: ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO"],
  },
]);

/* ------------------------------------------------------------------ login */

test("login: segue /moto/ → login.php → /login, envia CPF e senha e abre a área do motorista", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": STATUS_ESCALADO } });
  const r = await entrarNoPortal(CRED, { buscar: portal.buscar });

  assert.equal(r.ok, true, r.ok ? "" : r.leitura.diagnostico.join(" | "));
  assert.deepEqual(portal.caminhos(), [
    "GET moto/",
    "GET login.php",
    "GET login",
    "POST seguranca/valida_login.php",
    "GET moto/",
  ]);
  assert.equal(portal.logins, 1);

  // O POST usa os nomes REAIS dos campos da tela e não marca “Manter conectado”.
  const envio = portal.pedidos[3];
  const campos = new URLSearchParams(envio.corpo);
  assert.equal(campos.get("email"), CPF_FALSO);
  assert.equal(campos.get("password"), SENHA_FALSA);
  assert.equal(campos.has("lembrar"), false, "o leitor não pode pedir sessão de 30 dias");
  // O cookie de visitante nasceu num 302 e foi levado até o login.
  assert.match(envio.cookie, /PHPSESSID=visitante\d+/);
  // Depois do login vale o cookie NOVO que veio na resposta 302 do próprio login.
  assert.match(portal.pedidos[4].cookie, /PHPSESSID=logado\d+/);
  assert.doesNotMatch(portal.pedidos[4].cookie, /visitante/);

  if (r.ok) {
    assert.deepEqual(r.diagnostico, ["Login aceito pelo portal."]);
    assert.equal(new URL(r.pagina.url).pathname, "/moto/");
  }
  assert.deepEqual(portal.foraDoSite, []);
});

test("login: um 404 nunca vira “Login aceito” (o defeito original)", async () => {
  // O endereço antigo (/status.php) respondia 404 do Apache — sem campo de senha.
  let pedidos = 0;
  const so404 = (async () => {
    pedidos += 1;
    return html(PAGINA_404, 404);
  }) as unknown as typeof fetch;

  const entrada = await entrarNoPortal(CRED, { buscar: so404 });
  assert.equal(entrada.ok, false, "uma página sem login foi aceita como área do motorista");

  const leitura = await lerPortalDoMotorista(CRED, [], { buscar: so404 });
  assert.equal(leitura.ok, false);
  assert.equal(leitura.loginRecusado, false, "404 não é senha errada");
  assert.match(leitura.diagnostico.join(" "), /formulário de login/);
  assert.match(leitura.diagnostico.join(" "), /404/);
  assert.doesNotMatch(leitura.diagnostico.join(" "), /Login aceito/);
  assert.equal(leitura.totalLinhas, 0, "o texto do 404 não pode ser guardado como página do motorista");
  assert.ok(pedidos >= 2, "o leitor precisa ao menos procurar a tela de login");
});

test("login: senha errada é recusa (um envio só) e nada do segredo aparece", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": STATUS_ESCALADO } });
  const r = await lerPortalDoMotorista({ cpf: CPF_FALSO, senha: "outra-senha-errada" }, [], { buscar: portal.buscar });

  assert.equal(r.ok, false);
  assert.equal(r.loginRecusado, true);
  assert.equal(r.avisoPreciso, false);
  assert.equal(portal.logins, 1, "senha recusada não se repete na mesma leitura");
  assert.equal(portal.sessoes.size, 0);
  assert.match(r.diagnostico.join(" "), /recusou o CPF\/senha/);
  assert.ok(!JSON.stringify(r).includes("outra-senha-errada"));
  semSegredo(r, "leitura recusada");
});

for (const modo of ["redireciona", "pagina", "meta", "script"] as const) {
  test(`login: a resposta do portal ao login pode ser “${modo}” e a sessão abre do mesmo jeito`, async () => {
    const portal = criarPortalFalso({ aposLogin: modo, telas: { "moto/status": STATUS_ESCALADO } });
    const r = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" });

    assert.equal(r.ok, true, r.diagnostico.join(" | "));
    assert.equal(r.loginRecusado, false);
    assert.equal(portal.logins, 1);
    assert.match(r.diagnostico.join(" "), /Situação do ponto A032: ESCALADO/);
    assert.ok(r.secoes.some((s) => s.linhas.some((l) => l.includes("NAVIO DE EXEMPLO"))));
    semSegredo(r, `leitura (${modo})`);
    assert.deepEqual(portal.acoes, []);
    assert.deepEqual(portal.foraDoSite, []);
  });
}

test("login: erro HTTP ao receber o login é falha — não é “aceito” nem “senha recusada”", async () => {
  for (const status of [404, 403, 419]) {
    const buscar = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return html(PAGINA_404, status);
      return html(paginaLogin());
    }) as unknown as typeof fetch;
    const r = await lerPortalDoMotorista(CRED, [], { buscar });
    assert.equal(r.ok, false, `HTTP ${status} no login foi aceito`);
    assert.equal(r.loginRecusado, false, `HTTP ${status} contou como senha recusada`);
    assert.match(r.diagnostico.join(" "), new RegExp(`respondeu ${status} ao receber o login`));
    assert.doesNotMatch(r.diagnostico.join(" "), /Login aceito/);
  }
});

test("login: resposta em branco só vale se a área do motorista abrir em seguida", async () => {
  // 1) Em branco e a área volta para o login: a sessão não abriu.
  const naoAbriu = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return html("");
    return html(paginaLogin());
  }) as unknown as typeof fetch;
  const r1 = await lerPortalDoMotorista(CRED, [], { buscar: naoAbriu });
  assert.equal(r1.ok, false);
  assert.equal(r1.loginRecusado, true);
  assert.match(r1.diagnostico.join(" "), /voltou para a tela de entrada/);

  // 2) Em branco, mas a área abre com o cookie novo: entrou.
  let logado = false;
  const abriu = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      logado = true;
      return html("", 200, { "set-cookie": "PHPSESSID=abc; path=/" });
    }
    if (!logado) return html(paginaLogin());
    return String(url).includes("/moto/status") ? html(STATUS_ESCALADO) : html("<h1>Meu ponto</h1><p>Olá.</p>");
  }) as unknown as typeof fetch;
  const r2 = await lerPortalDoMotorista(CRED, [], { buscar: abriu, codigo: "A032" });
  assert.equal(r2.ok, true, r2.diagnostico.join(" | "));
  assert.match(r2.diagnostico.join(" "), /Situação do ponto A032: ESCALADO/);
});

test("login: CPF e senha só saem para o próprio portal", async () => {
  // Formulário apontando para outro site: nada é enviado.
  const enviados: string[] = [];
  const formularioDeFora = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") enviados.push(String(url));
    return html(paginaLogin({ action: "https://outro.exemplo.test/captura.php" }));
  }) as unknown as typeof fetch;
  const r1 = await lerPortalDoMotorista(CRED, [], { buscar: formularioDeFora });
  assert.equal(r1.ok, false);
  assert.deepEqual(enviados, [], "a senha foi enviada para outro site");
  assert.match(r1.diagnostico.join(" "), /outro site/);

  // Redirecionamento para fora depois do login: a leitura para e o cookie não vai junto.
  const visitados: string[] = [];
  const redirecionaParaFora = (async (url: string | URL | Request, init?: RequestInit) => {
    visitados.push(String(url));
    if (init?.method === "POST") {
      return new Response(null, { status: 302, headers: { location: "https://outro.exemplo.test/painel", "set-cookie": "PHPSESSID=abc; path=/" } });
    }
    return html(paginaLogin());
  }) as unknown as typeof fetch;
  const r2 = await lerPortalDoMotorista(CRED, [], { buscar: redirecionaParaFora });
  assert.equal(r2.ok, false);
  assert.ok(!visitados.some((u) => u.includes("outro.exemplo.test")), "o leitor seguiu o portal para outro site");
  assert.match(r2.diagnostico.join(" "), /outro site/);
});

test("login: captcha e portal fora do ar não enviam a senha", async () => {
  const comCaptcha = criarPortalFalso({ captcha: true });
  const r1 = await lerPortalDoMotorista(CRED, [], { buscar: comCaptcha.buscar });
  assert.equal(r1.captcha, true);
  assert.equal(r1.loginRecusado, false);
  assert.equal(comCaptcha.logins, 0);

  const fora = criarPortalFalso({ foraDoAr: true });
  const r2 = await lerPortalDoMotorista(CRED, [], { buscar: fora.buscar });
  assert.equal(r2.ok, false);
  assert.equal(r2.loginRecusado, false);
  assert.match(r2.diagnostico[0], /503/);
  assert.equal(fora.logins, 0);
});

test("endereço do portal: variável vazia vale o padrão e o caminho antigo /moto é aceito", () => {
  const antes = process.env.PORTAL_MOTORISTA_URL;
  try {
    // Variável criada VAZIA no painel da hospedagem não pode virar endereço inválido.
    process.env.PORTAL_MOTORISTA_URL = "";
    assert.equal(urlPortal("moto/"), `${PORTAL_BASE}/moto/`);
    assert.equal(urlPortal(), `${PORTAL_BASE}/moto/status`);
    delete process.env.PORTAL_MOTORISTA_URL;
    assert.equal(urlPortal("login"), `${PORTAL_BASE}/login`);
    process.env.PORTAL_MOTORISTA_URL = "https://portal.exemplo.test/moto/";
    assert.equal(urlPortal("moto/"), "https://portal.exemplo.test/moto/");
    assert.equal(urlPortal(""), "https://portal.exemplo.test");
  } finally {
    process.env.PORTAL_MOTORISTA_URL = antes;
  }
});

test("sessão: página em ISO-8859-1 é lida com os acentos certos", async () => {
  const latin1 = Buffer.from("<h1>ÚLTIMO PONTO ESCALADO</h1><p>NÃO ESTÁ NA FILA</p>", "latin1");
  const buscar = (async () =>
    new Response(latin1, { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" } })) as unknown as typeof fetch;
  const r = await new SessaoPortal(buscar, BASE_FALSA).pedir(`${BASE_FALSA}/moto/`);
  assert.equal(r.ok, true);
  assert.match(r.html, /ÚLTIMO PONTO ESCALADO/);
  assert.match(r.html, /NÃO ESTÁ NA FILA/);
});

test("sessão: laço de redirecionamento termina com erro, sem travar", async () => {
  let pedidos = 0;
  const laco = (async () => {
    pedidos += 1;
    return new Response(null, { status: 302, headers: { location: "/moto/" } });
  }) as unknown as typeof fetch;
  const r = await new SessaoPortal(laco, BASE_FALSA).pedir(`${BASE_FALSA}/moto/`);
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /vezes demais/);
  assert.ok(pedidos <= 10);
});

/* ------------------------------------------------------- telas da área logada */

test("telas: as abas vêm do menu do portal; “Sair” e botões de dispensa nunca são abertos", async () => {
  const portal = criarPortalFalso({
    telas: {
      "moto/status": telaStatus([{ codigo: "A032", situacao: "EM DISPENSA", linhas: ["MOTIVO", "001 - OFICINA"], botao: "Sair da dispensa" }]),
      "moto/fila": telaFila("A", "A102", [{ codigo: "A109", tipo: "TRUCK 4 EIXOS" }, { codigo: "A115", tipo: "TRUCK 4 EIXOS" }]),
    },
  });
  const r = await lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" });

  assert.equal(r.ok, true, r.diagnostico.join(" | "));
  assert.deepEqual(r.telas.map((t) => t.caminho).sort(), ["moto/", "moto/fila", "moto/status", "moto/ticket"]);
  // O leitor só OLHA: nenhum endereço de ação e nenhum caminho adivinhado.
  assert.deepEqual(portal.acoes, [], "o leitor abriu um link de ação (sair/dispensa)");
  const conhecidos = new Set(["moto/", "login.php", "login", "seguranca/valida_login.php", "moto/status", "moto/ticket", "moto/fila"]);
  for (const p of portal.pedidos) assert.ok(conhecidos.has(p.caminho.split("?")[0]), `pedido a um caminho adivinhado: ${p.caminho}`);
  assert.equal(portal.logins, 1, "todas as telas saem do mesmo login");
  assert.equal(portal.maxSimultaneos, 1, "as telas são abertas uma de cada vez");
  assert.match(r.diagnostico.join(" "), /Abas no menu: .*Status → moto\/status/);
  semSegredo(r, "telas lidas");
});

test("telas: a leitura periódica para assim que a situação do ponto aparece", async () => {
  const portal = criarPortalFalso({
    telas: {
      "moto/status": STATUS_ESCALADO,
      "moto/fila": telaFila("A", "A032", [{ codigo: "A109", tipo: "TRUCK 4 EIXOS" }]),
    },
  });
  const r = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" });
  assert.equal(r.ok, true, r.diagnostico.join(" | "));
  assert.deepEqual(portal.caminhos().slice(4), ["GET moto/", "GET moto/status"], "abriu telas além do necessário");
  assert.equal(new URL(r.urlFinal ?? "").pathname, "/moto/status");
  assert.equal(r.avisoPreciso, false);
});

test("telas: sem /moto/status, a tela de status é achada pela aba do menu", async () => {
  const menu = `<nav><a href="/moto/">Ponto</a><a href="/moto/situacao">Status</a><a href="/logout.php">Sair</a></nav>`;
  const portal = criarPortalFalso({
    telas: {
      "moto/": `<html><body>${menu}<h1>Meu ponto</h1><p>Bem-vindo.</p></body></html>`,
      "moto/situacao": telaStatus([{ codigo: "A032", situacao: "ATIVO" }], { menu }),
    },
  });
  const r = await lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" });
  assert.equal(r.ok, true, r.diagnostico.join(" | "));
  assert.match(r.diagnostico.join(" "), /moto\/status: não existe neste portal \(404\)/);
  assert.ok(r.telas.some((t) => t.caminho === "moto/situacao"));
  assert.ok(!r.telas.some((t) => t.caminho === "moto/status"), "a página 404 foi guardada como tela");
  assert.deepEqual(portal.acoes, []);
});

test("telas: sessão que cai no meio da visita não vira conteúdo", async () => {
  // O portal aceita o login, mas a tela de status devolve o login de novo.
  let logado = false;
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = new URL(String(url)).pathname;
    if (init?.method === "POST") {
      logado = true;
      return html("<h1>Meu ponto</h1><p>Bem-vindo.</p>", 200, { "set-cookie": "PHPSESSID=abc; path=/" });
    }
    if (!logado || caminho === "/moto/status") return html(paginaLogin());
    return html("<h1>Meu ponto</h1><p>Bem-vindo.</p>");
  }) as unknown as typeof fetch;
  const r = await lerTelasDoMotorista(CRED, [], { buscar, codigo: "A032" });
  assert.match(r.diagnostico.join(" "), /moto\/status: pediu login de novo/);
  assert.ok(!r.telas.some((t) => t.secoes.some((s) => s.linhas.some((l) => /Email ou CPF/.test(l)))), "a tela de login foi guardada como tela do motorista");
});
