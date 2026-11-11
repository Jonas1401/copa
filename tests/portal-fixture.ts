/**
 * PORTAL DO MOTORISTA DE MENTIRA — só para os testes. Nenhum pedido sai da
 * máquina e nenhum dado aqui é de uma pessoa, placa ou escala de verdade.
 *
 * O que imita do site real (observado SEM login, em 10/11/2026):
 *   - `GET /moto/` sem sessão → 302 `../login.php` → 302 `/login`, e o cookie
 *     `PHPSESSID` já nasce no primeiro 302;
 *   - a tela de login: formulário `POST ./seguranca/valida_login.php`, campo
 *     `email` (“Email ou CPF”), campo `password`, caixa `lembrar`, botão sem
 *     nome e nenhum token escondido;
 *   - `GET` no endereço que recebe o login → 500 sem corpo;
 *   - `/status.php` e `/moto/fila.php` → 404 do Apache.
 *
 * O que NÃO se sabe do site real e aqui é suposição declarada: como ele
 * responde ao login (por isso os testes cobrem redirecionamento, página direta,
 * `meta refresh` e `location.href`) e o HTML das telas logadas (por isso o
 * leitor é por linhas de texto, e não por seletor).
 *
 * O que se sabe pelas telas do site real (10/11/2026, mostradas pelo dono da
 * conta): o portal mostra o Status de UM ponto por vez. Em “Trocar Ponto” há
 * uma lista com os pontos da conta e o botão “Confirmar”; depois de confirmar,
 * aparece “Status do Ponto” com o cartão daquele ponto (código, placa, selo
 * ATIVO, “Ativado hoje, 19:50 · há 2 h 27 min”, nome e o botão “Entrar na
 * dispensa”). O `assets/app.js` público diz que cada tela é um recarregamento
 * completo e que os modais são abertos por `data-open-modal`. É o modo
 * `escolha` deste portal de mentira; o endereço e o nome do campo do
 * formulário são suposição (o leitor os descobre no próprio HTML).
 */

export const BASE_FALSA = "https://portal.exemplo.test";
/** Onze dígitos com os verificadores ERRADOS de propósito: não é o CPF de ninguém. */
export const CPF_FALSO = "10000000001";
export const SENHA_FALSA = "senha-de-teste-9";

export type PedidoFalso = { metodo: string; caminho: string; cookie: string; corpo: string };

/**
 * Conta em que o portal mostra UM ponto por vez, escolhido em “Trocar Ponto”
 * (como o site real). A escolha vale para a sessão.
 */
export type EscolhaFalsa = {
  cartoes: CartaoFalso[];
  /** Nome do campo da lista (padrão `id_ponto`). */
  campo?: string;
  /** Endereço que recebe a escolha, relativo a `/moto/` (padrão `trocar_ponto.php`). */
  acao?: string;
  metodo?: "POST" | "GET";
  /** O formulário leva um código escondido de uso único. */
  comCodigoOculto?: boolean;
  /** Depois da escolha o portal abre o Status (padrão) ou volta para a tela do ponto. */
  aposEscolha?: "status" | "ponto";
  /** A opção “Escolha o Ponto...” tem valor 0 em vez de vazio. */
  vazioComZero?: boolean;
};

/** Outra conta do portal de mentira: cada login só enxerga as próprias telas. */
export type ContaFalsa = { senha: string; telas?: Record<string, string>; escolha?: EscolhaFalsa };

export type OpcoesPortalFalso = {
  cpf?: string;
  senha?: string;
  /** Contas a mais (CPF → senha e telas), para testar vários motoristas. */
  contas?: Record<string, ContaFalsa>;
  /** Como o portal responde ao login certo. */
  aposLogin?: "redireciona" | "pagina" | "meta" | "script";
  /** Telas da área logada, por caminho (`moto/`, `moto/status`, `moto/fila`…). */
  telas?: Record<string, string>;
  /** A conta principal mostra um ponto por vez (tela “Trocar Ponto”). */
  escolha?: EscolhaFalsa;
  /** Tudo responde 503 (portal fora do ar). */
  foraDoAr?: boolean;
  /** A tela de login traz captcha. */
  captcha?: boolean;
};

/** Tela de login com a mesma estrutura do formulário real. */
export function paginaLogin(opcoes: { erro?: boolean; captcha?: boolean; action?: string } = {}): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Portal - Login</title></head><body>
<main><h1>Bem-vindo</h1><p>Faça login para continuar</p>
${opcoes.erro ? '<div class="alert">Email/CPF ou senha inválidos.</div>' : ""}
<form method="POST" action="${opcoes.action ?? "./seguranca/valida_login.php"}">
  <label for="email">Email ou CPF</label>
  <input type="text" id="email" name="email" required>
  <label for="password">Senha</label>
  <input type="password" id="password" name="password" required>
  <label><input type="checkbox" name="lembrar" value="1"> Manter conectado</label>
  ${opcoes.captcha ? '<div class="g-recaptcha" data-sitekey="x"></div>' : ""}
  <button type="submit">Entrar</button>
</form></main><script src="assets/app.js"></script></body></html>`;
}

export const PAGINA_404 = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>404 Not Found</title></head><body>
<h1>Not Found</h1><p>The requested URL was not found on this server.</p><hr>
<address>Apache/2.4.58 (Ubuntu) Server at portal.exemplo.test Port 443</address></body></html>`;

export type CartaoFalso = {
  codigo: string;
  placa?: string;
  situacao: string;
  /** Demais linhas do cartão (dados da escala, motivo da dispensa…). */
  linhas?: string[];
  nome?: string;
  /** Texto do botão de AÇÃO do cartão (o leitor nunca pode abrir). */
  botao?: string;
};

/** Menu da área logada: quatro abas de navegação e o “Sair”. */
export const MENU_FALSO = `<nav class="abas">
  <a href="/moto/">Ponto</a><a href="/moto/status">Status</a><a href="/moto/ticket">Ticket</a><a href="/moto/fila">Fila</a>
  <a href="/logout.php">Sair</a>
</nav>`;

/** Rodapé igual em todas as telas (moldura do site: não é dado do ponto). */
export const RODAPE_FALSO = `<footer><p>Portal do Motorista · atendimento 0800 000 0000</p></footer>`;

/** Tela “Status do Ponto” com um cartão por ponto do motorista. */
export function telaStatus(cartoes: CartaoFalso[], opcoes: { menu?: string } = {}): string {
  const corpo = cartoes
    .map(
      (c) => `<section class="cartao">
  <div class="topo"><b>${c.codigo}</b> <span class="chip">${c.placa ?? "ABC-1D23"}</span> <span class="selo">${c.situacao}</span></div>
  ${(c.linhas ?? []).map((l) => `<div>${l}</div>`).join("\n  ")}
  <div class="motorista">${c.nome ?? "FULANO DE TAL EXEMPLO"}</div>
  ${c.botao ? `<a class="botao" href="/moto/dispensa/alternar?ponto=${c.codigo}">${c.botao}</a>` : ""}
</section>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Status</title></head><body>
${opcoes.menu ?? MENU_FALSO}
<h1>Status do Ponto</h1>
${corpo}
${RODAPE_FALSO}</body></html>`;
}

/** Tela “Trocar Ponto”: a lista de pontos da conta e o botão “Confirmar”. */
export function telaTrocarPonto(e: EscolhaFalsa, codigoOculto?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Trocar Ponto</title></head><body>
${MENU_FALSO}
<h1>Trocar Ponto</h1>
<div class="card"><h2>Escolha seu ponto</h2>
<form method="${e.metodo ?? "POST"}" action="${e.acao ?? "trocar_ponto.php"}">
  ${codigoOculto ? `<input type="hidden" name="_token" value="${codigoOculto}">` : ""}
  <label for="ponto">PONTO</label>
  <select id="ponto" name="${e.campo ?? "id_ponto"}" required>
    <option value="${e.vazioComZero ? "0" : ""}">Escolha o Ponto...</option>
    ${e.cartoes.map((c, i) => `<option value="${101 + i}">${c.codigo}</option>`).join("\n    ")}
  </select>
  <button type="submit" class="btn">Confirmar</button>
</form></div>
${RODAPE_FALSO}<script src="assets/app.js"></script></body></html>`;
}

/**
 * “Status do Ponto” do ponto escolhido: um cartão só, com o botão de dispensa
 * no fim e o formulário de dispensa num modal (que o leitor nunca pode enviar).
 */
export function telaStatusDeUmPonto(c: CartaoFalso): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Status</title></head><body>
${MENU_FALSO}
<h1>Status do Ponto</h1>
<div class="card">
  <div class="card__topo"><span class="codigo">${c.codigo}</span> <span class="placa">${c.placa ?? "ABC-1D23"}</span> <span class="badge">${c.situacao}</span></div>
  ${(c.linhas ?? []).map((l) => `<div class="linha">${l}</div>`).join("\n  ")}
  <div class="linha">${c.nome ?? "FULANO DE TAL EXEMPLO"}</div>
  <hr>
  ${c.botao ? `<button type="button" class="btn" data-open-modal="modal-dispensa">${c.botao}</button>` : ""}
</div>
${
  c.botao
    ? `<div class="app-modal-backdrop" id="modal-dispensa"><div class="app-modal">
  <h2>${c.botao}</h2>
  <form method="POST" action="dispensa/alternar.php">
    <input type="hidden" name="ponto" value="${c.codigo}">
    <label for="motivo">Motivo</label>
    <select id="motivo" name="motivo"><option value="">Selecione...</option><option value="1">001 - OFICINA</option><option value="2">002 - DESCANSO</option></select>
    <button type="button" data-close-modal>Cancelar</button>
    <button type="submit" class="btn">Confirmar</button>
  </form>
</div></div>`
    : ""
}
${RODAPE_FALSO}<script src="assets/app.js"></script></body></html>`;
}

/** Aba “Fila” (tela de ativos): último escalado e a sequência de um livro. */
export function telaFila(livro: string, ultimo: string, fila: { codigo: string; tipo: string }[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Fila</title></head><body>
${MENU_FALSO}
<h2>Livro ${livro} - Truck</h2>
<div>ÚLTIMO PONTO ESCALADO</div><div>${ultimo}</div>
<table><tr><th>SEQ</th><th>PONTO</th><th>TIPO</th></tr>
${fila.map((f, i) => `<tr><td>${i + 1}</td><td>${f.codigo}</td><td>${f.tipo}</td></tr>`).join("\n")}
</table>
${RODAPE_FALSO}</body></html>`;
}

export const TELA_TICKET_FALSA = `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Ticket</title></head><body>
${MENU_FALSO}
<h1>Ticket</h1><p>Nenhum ticket emitido hoje.</p>
${RODAPE_FALSO}</body></html>`;

export const TELA_PONTO_FALSA = `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Ponto</title></head><body>
${MENU_FALSO}
<h1>Meu ponto</h1><p>Escolha uma aba para ver os detalhes.</p>
${RODAPE_FALSO}</body></html>`;

type Resposta = { status: number; corpo?: string; cabecalhos?: Record<string, string>; cookie?: string };

/**
 * Cria o portal de mentira. `buscar` entra no lugar do `fetch`; `pedidos`,
 * `logins`, `acoes` e `foraDoSite` contam o que o leitor fez.
 */
export function criarPortalFalso(opcoes: OpcoesPortalFalso = {}) {
  const cpf = opcoes.cpf ?? CPF_FALSO;
  const telasPadrao = () => ({ "moto/": TELA_PONTO_FALSA, "moto/ticket": TELA_TICKET_FALSA }) as Record<string, string>;
  const estado = {
    /** Telas da conta principal (`cpf`); o teste pode trocar entre uma leitura e outra. */
    telas: { ...telasPadrao(), ...(opcoes.telas ?? {}) } as Record<string, string>,
    /** A conta principal mostra um ponto por vez; o teste pode mudar os cartões entre as leituras. */
    escolha: opcoes.escolha,
    /** Demais contas, por CPF. */
    contas: Object.fromEntries(
      Object.entries(opcoes.contas ?? {}).map(([c, conta]) => [
        c,
        { senha: conta.senha, telas: { ...telasPadrao(), ...(conta.telas ?? {}) }, escolha: conta.escolha },
      ]),
    ) as Record<string, { senha: string; telas: Record<string, string>; escolha?: EscolhaFalsa }>,
    /** Ponto escolhido em cada sessão (cookie → código). */
    pontoDaSessao: new Map<string, string>(),
    /** Escolhas de ponto recebidas (“Trocar Ponto” → Confirmar), na ordem. */
    trocas: [] as string[],
    /** Escolhas recusadas (código escondido errado, ponto que não é da conta…). */
    trocasRecusadas: 0,
    aposLogin: opcoes.aposLogin ?? "redireciona",
    foraDoAr: Boolean(opcoes.foraDoAr),
    captcha: Boolean(opcoes.captcha),
    senha: opcoes.senha ?? SENHA_FALSA,
    /** Sessões abertas por um login aceito: cookie → CPF da conta. */
    sessoes: new Map<string, string>(),
    pedidos: [] as PedidoFalso[],
    /** POSTs de login recebidos (certos ou errados). */
    logins: 0,
    /** POSTs de login por CPF digitado. */
    loginsPorCpf: {} as Record<string, number>,
    /** Endereços de AÇÃO que alguém abriu (sair, dispensa…): tem de ficar vazio. */
    acoes: [] as string[],
    /** Pedidos feitos para fora do portal: tem de ficar vazio. */
    foraDoSite: [] as string[],
    /** Maior número de pedidos em andamento ao mesmo tempo. */
    maxSimultaneos: 0,
    /** Caminhos pedidos, na ordem (sem os parâmetros). */
    caminhos(): string[] {
      return estado.pedidos.map((p) => `${p.metodo} ${p.caminho.split("?")[0]}`);
    },
  };
  /** Cookies de visitante emitidos pelo portal (antes do login). */
  const visitantes = new Set<string>();
  /** Código escondido (uso único) do formulário de “Trocar Ponto”, por sessão. */
  const codigosOcultos = new Map<string, string>();
  let serie = 0;
  let emAndamento = 0;

  const responder = (url: URL, metodo: string, sessao: string, corpo: string): Resposta => {
    if (estado.foraDoAr) return { status: 503, corpo: "Serviço indisponível" };
    const caminho = url.pathname.replace(/^\/+/, "");
    const dono = estado.sessoes.get(sessao);
    const logado = dono !== undefined;
    const telasDe = (c: string) => (c === cpf ? estado.telas : (estado.contas[c]?.telas ?? {}));

    if (/logout|dispensa|sair/i.test(caminho)) {
      estado.acoes.push(caminho);
      estado.sessoes.delete(sessao);
      return { status: 302, cabecalhos: { location: "/login" } };
    }
    if (caminho === "login.php") return { status: 302, cabecalhos: { location: "/login" } };
    if (caminho === "login") {
      return { status: 200, corpo: paginaLogin({ erro: url.searchParams.has("erro"), captcha: estado.captcha }) };
    }
    if (caminho === "seguranca/valida_login.php") {
      if (metodo !== "POST") return { status: 500, corpo: "" };
      estado.logins += 1;
      const campos = new URLSearchParams(corpo);
      const digitado = campos.get("email") ?? "";
      estado.loginsPorCpf[digitado] = (estado.loginsPorCpf[digitado] ?? 0) + 1;
      const senhaCerta = digitado === cpf ? estado.senha : estado.contas[digitado]?.senha;
      // Como num PHP com sessão: o login só vale para quem chegou com o cookie
      // de visitante que o próprio portal entregou nos redirecionamentos.
      const veioComCookie = visitantes.has(sessao) || logado;
      if (!veioComCookie || senhaCerta === undefined || campos.get("password") !== senhaCerta) {
        return { status: 302, cabecalhos: { location: "../login?erro=1" } };
      }
      // …e a resposta do login TROCA o cookie da sessão.
      const nova = `logado${++serie}`;
      estado.sessoes.set(nova, digitado);
      const cookie = `PHPSESSID=${nova}; path=/; HttpOnly`;
      if (estado.aposLogin === "pagina") return { status: 200, corpo: telasDe(digitado)["moto/"] ?? "", cookie };
      if (estado.aposLogin === "meta") {
        return { status: 200, corpo: '<html><head><meta http-equiv="refresh" content="0; url=../moto/"></head><body></body></html>', cookie };
      }
      if (estado.aposLogin === "script") {
        return { status: 200, corpo: '<html><body><script>window.location.href = "../moto/";</script></body></html>', cookie };
      }
      return { status: 302, cabecalhos: { location: "../moto/" }, cookie };
    }
    if (caminho === "moto" || caminho.startsWith("moto/")) {
      if (!logado) return { status: 302, cabecalhos: { location: "../login.php" } };
      const e = dono === cpf ? estado.escolha : estado.contas[dono]?.escolha;
      if (e) {
        const novoCodigo = () => {
          if (!e.comCodigoOculto) return undefined;
          const valor = `tk${++serie}x`;
          codigosOcultos.set(sessao, valor);
          return valor;
        };
        if (caminho === `moto/${e.acao ?? "trocar_ponto.php"}`) {
          if (metodo !== (e.metodo ?? "POST")) return { status: 302, cabecalhos: { location: "/moto/" } };
          const campos = metodo === "POST" ? new URLSearchParams(corpo) : url.searchParams;
          const i = Number(campos.get(e.campo ?? "id_ponto")) - 101;
          const cartao = Number.isInteger(i) ? e.cartoes[i] : undefined;
          const codigoCerto = !e.comCodigoOculto || (campos.get("_token") ?? "") === codigosOcultos.get(sessao);
          codigosOcultos.delete(sessao);
          if (!cartao || !codigoCerto) {
            estado.trocasRecusadas += 1;
            return { status: 302, cabecalhos: { location: "/moto/" } };
          }
          estado.pontoDaSessao.set(sessao, cartao.codigo);
          estado.trocas.push(cartao.codigo);
          return { status: 302, cabecalhos: { location: e.aposEscolha === "ponto" ? "/moto/" : "/moto/status" } };
        }
        if (caminho === "moto" || caminho === "moto/") return { status: 200, corpo: telaTrocarPonto(e, novoCodigo()) };
        if (caminho === "moto/status") {
          const escolhido = e.cartoes.find((c) => c.codigo === estado.pontoDaSessao.get(sessao));
          // Sem ponto escolhido nesta sessão, o portal manda escolher.
          return escolhido ? { status: 200, corpo: telaStatusDeUmPonto(escolhido) } : { status: 302, cabecalhos: { location: "/moto/" } };
        }
      }
      const tela = telasDe(dono)[caminho === "moto" ? "moto/" : caminho];
      return tela === undefined ? { status: 404, corpo: PAGINA_404 } : { status: 200, corpo: tela };
    }
    return { status: 404, corpo: PAGINA_404 };
  };

  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entrada === "string" || entrada instanceof URL ? String(entrada) : entrada.url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    if (url.origin !== BASE_FALSA) {
      estado.foraDoSite.push(url.toString());
      return new Response("fora do portal", { status: 599 });
    }
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    const corpo = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    estado.pedidos.push({ metodo, caminho: `${url.pathname.replace(/^\/+/, "")}${url.search}`, cookie, corpo });
    emAndamento += 1;
    estado.maxSimultaneos = Math.max(estado.maxSimultaneos, emAndamento);
    try {
      // Um instante de rede: sem ele dois logins "simultâneos" nunca se cruzariam.
      await new Promise((r) => setTimeout(r, 2));
      const sessao = /PHPSESSID=([^;]+)/.exec(cookie)?.[1] ?? "";
      const r = responder(url, metodo, sessao, corpo);
      const cabecalhos = new Headers({ "content-type": "text/html; charset=UTF-8", ...(r.cabecalhos ?? {}) });
      if (r.cookie) cabecalhos.append("set-cookie", r.cookie);
      else if (!sessao && !estado.foraDoAr) {
        // Todo visitante sem cookie ganha um — inclusive numa resposta 302.
        const visitante = `visitante${++serie}`;
        visitantes.add(visitante);
        cabecalhos.append("set-cookie", `PHPSESSID=${visitante}; path=/`);
      }
      return new Response(r.status >= 300 && r.status < 400 ? null : r.corpo ?? "", { status: r.status, headers: cabecalhos });
    } finally {
      emAndamento -= 1;
    }
  }) as unknown as typeof fetch;

  return Object.assign(estado, { buscar });
}

export type PortalFalso = ReturnType<typeof criarPortalFalso>;
