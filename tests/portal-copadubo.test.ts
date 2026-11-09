import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  analisarPortal,
  cpfPlausivel,
  escolherFormularioLogin,
  extrairFormularios,
  extrairSecoes,
  hashConteudo,
  limparCpf,
  linhasAlteradas,
  linhasDeInteresse,
  mascararCpf,
  montarCorpoLogin,
  todasAsLinhas,
} from "../src/lib/portal-copadubo-parse";
import { lerPortalDoMotorista } from "../src/lib/portal-copadubo";

/**
 * Portal do motorista da Copadubo (portal.copadubo.com.br).
 *
 * O leitor é GENÉRICO: não amarra campos fixos da página de status. Estes
 * testes provam que ele descobre o formulário de login pelo campo de senha,
 * monta o POST com os nomes REAIS dos campos, transforma qualquer página em
 * seções/linhas e aponta só o que mudou — que é o que gera o aviso.
 *
 * Também provam o contrário do resto: que CPF e senha nunca aparecem em
 * resultado, diagnóstico ou aviso.
 */

const CPF = "12345678901";
const SENHA = "minha-senha-secreta";

/** Tela de login parecida com a do portal (CPF/e-mail + senha + token). */
const LOGIN = `<!doctype html><html><head><title>Copadubo - Login</title></head><body>
<img src="/img/logo/logo-branca.png">
<h1>Bem-vindo</h1><p>Faça login para continuar</p>
<form action="/login.php" method="post">
  <input type="hidden" name="csrf" value="abc123">
  <label for="usuario">Email ou CPF</label>
  <input id="usuario" name="login_usuario" type="text">
  <label for="senha">Senha</label>
  <input id="senha" name="login_senha" type="password">
  <input type="checkbox" name="manter" value="1">
  <button type="submit" name="entrar" value="1">Entrar</button>
</form></body></html>`;

/** Página de status: layout de TABELA (o formato mais comum em PHP). */
const STATUS = `<html><head><title>Copadubo - Status</title></head><body>
<div class="menu"><a href="/moto/status.php">Status</a><a href="/moto/historico.php">Histórico</a></div>
<h2>Meu ponto</h2>
<table>
  <tr><th>Ponto</th><th>Situação</th></tr>
  <tr><td>A184</td><td>Aguardando chamada</td></tr>
  <tr><td>Posição na fila</td><td>3</td></tr>
</table>
<h3>Atendimentos</h3>
<table>
  <tr><td>14/11/2026</td><td>Fospar</td><td>Finalizado</td></tr>
</table>
<h3>Contato</h3><p>Plantão: (41) 98417-5303</p>
</body></html>`;

test("o formulário de login é descoberto pelo campo de senha, com os nomes reais", () => {
  const f = escolherFormularioLogin(LOGIN);
  assert.ok(f, "não achou o formulário de login");
  assert.equal(f.method, "post");
  assert.equal(f.action, "/login.php");
  assert.equal(f.temSenha, true);
  assert.equal(f.temCaptcha, false);
  assert.deepEqual(
    f.campos.map((c) => c.nome).sort(),
    ["csrf", "login_senha", "login_usuario", "manter"].sort(),
  );
  // O rótulo visível vira o nome do campo na leitura genérica.
  assert.equal(f.campos.find((c) => c.nome === "login_usuario")?.rotulo, "Email ou CPF");
  assert.deepEqual(f.botoes, [{ nome: "entrar", valor: "1" }]);
  assert.equal(extrairFormularios(STATUS).length, 0, "a página de status não tem formulário");
});

test("o POST do login usa CPF no campo de usuário e a senha no campo de senha", () => {
  const f = escolherFormularioLogin(LOGIN)!;
  const corpo = montarCorpoLogin(f, { cpf: CPF, senha: SENHA });
  assert.equal(corpo.get("login_usuario"), CPF);
  assert.equal(corpo.get("login_senha"), SENHA);
  assert.equal(corpo.get("csrf"), "abc123", "o token escondido tem de continuar indo");
  assert.equal(corpo.get("entrar"), "1", "o nome do botão Entrar faz parte do POST");
  assert.ok(!corpo.has("manter"), "checkbox não marcado não vai no corpo");
});

test("login com captcha é reconhecido (não adianta tentar por HTTP)", () => {
  const comCaptcha = LOGIN.replace(
    '<button type="submit"',
    '<div class="g-recaptcha" data-sitekey="x"></div><button type="submit"',
  );
  const f = escolherFormularioLogin(comCaptcha)!;
  assert.equal(f.temCaptcha, true);
});

test("a página é lida por seções, sem saber o layout de antemão", () => {
  const { secoes, totalLinhas, pareceLogin } = extrairSecoes(STATUS);
  assert.equal(pareceLogin, false);
  const tudo = todasAsLinhas(secoes);
  // Títulos viram nomes de seção.
  assert.ok(secoes.some((s) => s.titulo.startsWith("Meu ponto")), JSON.stringify(secoes.map((s) => s.titulo)));
  // Cada célula da tabela vira uma coluna da linha, na ordem.
  assert.ok(tudo.includes("A184 · Aguardando chamada"), "a tabela perdeu a estrutura de colunas");
  assert.ok(tudo.includes("Posição na fila · 3"));
  assert.ok(tudo.includes("14/11/2026 · Fospar · Finalizado"));
  // Nada de menu (uma linha só com links) some: o texto continua legível.
  assert.ok(totalLinhas >= 5, `poucas linhas: ${totalLinhas}`);
});

test("layout diferente (divs/definição) também é lido — o leitor não é amarrado a tabela", () => {
  const pagina = `<html><body>
    <h2>Situação do veículo</h2>
    <div><span>Placa:</span> <b>ABC1D23</b></div>
    <div>Status: liberado para carregar</div>
    <h2>Próxima chamada</h2>
    <ul><li>Livro A — 10:20</li><li>Livro M — 11:05</li></ul>
  </body></html>`;
  const { secoes } = extrairSecoes(pagina);
  const tudo = todasAsLinhas(secoes);
  assert.ok(tudo.some((l) => l.includes("ABC1D23")), tudo.join(" | "));
  assert.ok(tudo.some((l) => /Status: liberado/.test(l)), tudo.join(" | "));
  assert.ok(tudo.includes("Livro A — 10:20"));
  assert.ok(secoes.some((s) => s.titulo === "Próxima chamada"));
});

test("o que interessa ao motorista vem primeiro (fila, chamada, status…)", () => {
  const { secoes } = extrairSecoes(STATUS);
  const sinais = linhasDeInteresse(secoes);
  assert.ok(sinais.length >= 2, JSON.stringify(sinais));
  assert.ok(sinais.some((l) => /Posição na fila/.test(l)), JSON.stringify(sinais));
  assert.ok(sinais.some((l) => /Aguardando chamada/.test(l)), JSON.stringify(sinais));
});

test("só a mudança real entra no aviso (e a comparação é estável)", () => {
  const antes = extrairSecoes(STATUS).secoes;
  const depoisHtml = STATUS.replace("<td>3</td>", "<td>1</td>").replace("Aguardando chamada", "Sua vez");
  const depois = extrairSecoes(depoisHtml).secoes;
  const { novas, removidas } = linhasAlteradas(antes, depois);
  assert.deepEqual(novas.sort(), ["A184 · Sua vez", "Posição na fila · 1"].sort());
  assert.deepEqual(removidas.sort(), ["A184 · Aguardando chamada", "Posição na fila · 3"].sort());
  // Duas leituras iguais → nenhuma novidade e o mesmo hash.
  assert.deepEqual(linhasAlteradas(depois, depois), { novas: [], removidas: [] });
  assert.equal(hashConteudo(antes), hashConteudo(antes));
  assert.notEqual(hashConteudo(antes), hashConteudo(depois));
});

test("entidades e acentos são decodificados (o texto do portal vem com &ccedil; etc.)", () => {
  const { secoes } = extrairSecoes("<h3>Situa&ccedil;&atilde;o</h3><p>N&atilde;o h&aacute; chamada</p>");
  assert.equal(secoes[0].titulo, "Situação");
  assert.equal(secoes[0].linhas[0], "Não há chamada");
});

test("CPF: só dígitos, 11 números, sem sequência repetida, mascarado na tela", () => {
  assert.equal(limparCpf("123.456.789-01"), CPF);
  assert.equal(cpfPlausivel(CPF), true);
  assert.equal(cpfPlausivel("11111111111"), false);
  assert.equal(cpfPlausivel("123"), false);
  assert.equal(mascararCpf(CPF), "***.***.789-01");
  assert.ok(!mascararCpf(CPF).includes(CPF));
});

test("diagrama de uma leitura completa: login, status e nenhum segredo no resultado", async () => {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const alvo = String(url);
    pedidos.push({ url: alvo, init });
    if (!init || init.method !== "POST") return new Response(LOGIN, { status: 200, headers: { "content-type": "text/html" } });
    // Confere o POST como o portal faria: sem a senha certa, volta ao login.
    const corpo = new URLSearchParams(String(init.body));
    if (corpo.get("login_usuario") !== CPF || corpo.get("login_senha") !== SENHA) {
      return new Response(LOGIN, { status: 200 });
    }
    return new Response(STATUS, { status: 200, headers: { "set-cookie": "PHPSESSID=xyz; path=/" } });
  }) as unknown as typeof fetch;

  process.env.PORTAL_MOTORISTA_URL = "https://portal.exemplo.test";
  const primeira = await lerPortalDoMotorista({ cpf: CPF, senha: SENHA }, [], { buscar });
  assert.equal(primeira.ok, true, primeira.diagnostico.join(" | "));
  assert.equal(primeira.loginRecusado, false);
  assert.ok(primeira.totalLinhas >= 5);
  assert.ok(pedidos.some((p) => p.init?.method === "POST" && String(p.init.body).includes(`login_senha=${SENHA}`)));

  // O resultado inteiro (que vai para o banco e para o /admin) não tem segredo.
  const serializado = JSON.stringify({ ...primeira, texto: "" });
  assert.ok(!serializado.includes(SENHA), "a senha vazou no resultado da leitura");
  assert.ok(!serializado.includes(CPF), "o CPF vazou no resultado da leitura");

  // Segunda leitura: o portal mudou a fila → o leitor aponta a novidade.
  const mudado = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!init || init.method !== "POST") return new Response(LOGIN, { status: 200 });
    return new Response(STATUS.replace("<td>3</td>", "<td>1</td>"), { status: 200 });
  }) as unknown as typeof fetch;
  const segunda = await lerPortalDoMotorista({ cpf: CPF, senha: SENHA }, primeira.secoes, { buscar: mudado });
  assert.deepEqual(segunda.novas, ["Posição na fila · 1"]);
  assert.deepEqual(segunda.removidas, ["Posição na fila · 3"]);

  // Senha errada → login recusado (não é "sem conteúdo").
  const errada = await lerPortalDoMotorista({ cpf: CPF, senha: "senha-errada" }, [], { buscar });
  assert.equal(errada.ok, false);
  assert.equal(errada.loginRecusado, true);
  assert.ok(!errada.diagnostico.join(" ").includes("senha-errada"));
});

test("portal fora do ar e captcha têm diagnóstico próprio (e nenhum aviso falso)", async () => {
  process.env.PORTAL_MOTORISTA_URL = "https://portal.exemplo.test";
  const fora = (async () => new Response("erro", { status: 503 })) as unknown as typeof fetch;
  const r1 = await lerPortalDoMotorista({ cpf: CPF, senha: SENHA }, [], { buscar: fora });
  assert.equal(r1.ok, false);
  assert.match(r1.diagnostico[0], /503/);

  const captcha = (async () =>
    new Response(LOGIN.replace('<button type="submit"', '<div class="g-recaptcha"></div><button type="submit"'), { status: 200 })
  ) as unknown as typeof fetch;
  const r2 = await lerPortalDoMotorista({ cpf: CPF, senha: SENHA }, [], { buscar: captcha });
  assert.equal(r2.captcha, true);
  assert.equal(r2.avisoPreciso, false);
});

test("a análise completa traz sinais e não confunde a página de status com o login", () => {
  const a = analisarPortal(STATUS);
  assert.equal(a.pareceLogin, false);
  assert.equal(a.titulo, "Copadubo - Status");
  assert.ok(a.sinais.length > 0);
  const b = analisarPortal(LOGIN);
  assert.equal(b.pareceLogin, true);
});

test("segurança: o módulo não escreve a senha em log nem devolve as credenciais", () => {
  const fonte = readFileSync("src/lib/portal-copadubo.ts", "utf8");
  // Nenhum console.* pode receber senha/credenciais.
  for (const linha of fonte.split("\n")) {
    if (!/console\.(log|warn|error|info)/.test(linha)) continue;
    assert.ok(!/senha|senhaCifrada|credenciais/i.test(linha), `log suspeito: ${linha.trim()}`);
  }
  // O acesso público não expõe o CPF inteiro nem a senha.
  const api = readFileSync("src/app/api/portal/route.ts", "utf8");
  assert.ok(!/cpf:\s*acesso/.test(api), "a rota devolveu o CPF do banco");
  assert.ok(!/senhaCifrada:\s*acesso/.test(api), "a rota devolveu a senha cifrada");
});

test("página logada que só menciona 'senha' no menu não é confundida com login recusado", async () => {
  process.env.PORTAL_MOTORISTA_URL = "https://portal.exemplo.test";
  const logado = `<html><body>
    <nav><a href="/moto/trocar-senha.php">Trocar senha</a><a href="/moto/status.php">Status</a></nav>
    <h2>Minha senha de acesso</h2><p>Para alterar a senha, use o menu acima.</p>
    <h2>Meu ponto</h2><table><tr><td>A184</td><td>Aguardando</td></tr></table>
  </body></html>`;
  const buscar = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (!init || init.method !== "POST") return new Response(LOGIN, { status: 200 });
    return new Response(logado, { status: 200 });
  }) as unknown as typeof fetch;
  const r = await lerPortalDoMotorista({ cpf: CPF, senha: SENHA }, [], { buscar });
  assert.equal(r.loginRecusado, false, "leu a página logada como se fosse recusa de senha");
  assert.equal(r.ok, true);
  assert.ok(r.secoes.some((s) => s.linhas.includes("A184 · Aguardando")));
});
