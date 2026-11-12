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

/** Uma viagem na tela “Tickets”, escrita como a tela escreve. */
export type LancamentoFalso = { quant: string; valor: string; servico: string; data: string; hora: string };

/**
 * A aba “Ticket” (“2ª Via de Ticket”) de uma conta: a lista de pontos, a lista
 * de semanas e o que o “Gerar” mostra. Do site real só se conhece a TELA (em
 * foto, 11/11/2026): as duas listas, o botão “Gerar” e, no resultado, o
 * período, o botão “Gerar PDF” e o quadro “Lançamentos” (PONTO · QUANT · VALOR
 * · SERVIÇO · DATA · HORA) ou “Nenhum lançamento encontrado para este período.”
 * Endereços, nomes dos campos e HTML são suposição — o leitor os descobre na
 * própria tela, e os testes cobrem as variações.
 */
export type TicketFalso = {
  /** Pontos da conta, na ordem da lista (o código pode se repetir). */
  pontos: string[];
  /** Semanas da lista, como a tela escreve: “09/11/2026 - 16/11/2026”. */
  semanas: string[];
  /** Índice da semana que vem marcada (padrão: a primeira). */
  marcada?: number;
  /** Viagens por opção de ponto e semana: a chave é `"índiceDoPonto|índiceDaSemana"`. */
  lancamentos: Record<string, LancamentoFalso[]>;
  /** Como o quadro é montado (padrão: `tabela`). */
  forma?: "tabela" | "linhas" | "celulas";
  /** Hipótese de HTML com apenas as quatro colunas visíveis na foto. */
  quatroColunas?: boolean;
  metodo?: "POST" | "GET";
  /** Endereço que recebe o “Gerar”, relativo a `/moto/` (padrão `ticket_lista.php`). */
  acao?: string;
  campoPonto?: string;
  campoSemana?: string;
  /** O formulário leva um código escondido de uso único. */
  comCodigoOculto?: boolean;
  /** O botão “Gerar” tem nome (alguns PHP exigem o nome dele no pedido). */
  botaoComNome?: boolean;
  /** As listas vêm fora de um formulário (a tela enviaria por JavaScript). */
  semFormulario?: boolean;
  /** O formulário traz também um campo para digitar. */
  comCampoDeTexto?: boolean;
  /** O resultado escreve “TOTAL GERAL: N VIAGENS - X TONS” (como o PDF). */
  comTotal?: boolean;
  /** …com uma viagem a mais do que as linhas. */
  totalErrado?: boolean;
  /** A resposta chega pela metade: corta no meio das linhas. */
  cortada?: boolean;
  /** O resultado não escreve o período. */
  semPeriodo?: boolean;
  /** O portal ignora a semana pedida e mostra a deste índice. */
  mostraSemana?: number;
  /** As linhas do resultado vêm com este código de ponto, e não com o pedido. */
  mostraPonto?: string;
};

/** Outra conta do portal de mentira: cada login só enxerga as próprias telas. */
export type ContaFalsa = { senha: string; telas?: Record<string, string>; escolha?: EscolhaFalsa; tickets?: TicketFalso };

/** Um quadro da “Tela de Ativos”: o último escalado e a fila, na ordem. */
export type QuadroFalso = { ultimo: string | null; pontos: { codigo: string; tipo: string }[] };

/**
 * A aba “Fila” (a Tela de Ativos), igual para todas as contas: os quadros
 * Truck e Carreta de cada livro. O teste pode trocar `livros` entre as leituras.
 */
export type FilaFalsa = {
  livros: Partial<Record<"A" | "B" | "M", { truck: QuadroFalso; carreta: QuadroFalso }>>;
  /** Livro mostrado quando o endereço não diz qual (padrão: A). */
  padrao?: "A" | "B" | "M";
  /** Como a tabela é montada — o HTML de verdade nunca foi visto (padrão: `tabela`). */
  forma?: "tabela" | "linhas" | "celulas";
  /** A tela não escreve “Total: N”. */
  semTotal?: boolean;
  /** A resposta chega pela metade: corta no meio da tabela da Carreta. */
  cortada?: boolean;
  /** O cartão deste quadro não é desenhado (como um portal que esconde a fila sem pontos). */
  semCartao?: "truck" | "carreta";
  /** Ponto que a tela cita em “Seu ponto (…) não está na fila deste livro no momento.” */
  pontoDaConta?: string;
};

export type OpcoesPortalFalso = {
  cpf?: string;
  senha?: string;
  /** Contas a mais (CPF → senha e telas), para testar vários motoristas. */
  contas?: Record<string, ContaFalsa>;
  /** Como o portal responde ao login certo. */
  aposLogin?: "redireciona" | "pagina" | "meta" | "script";
  /** A aba “Fila” como o portal de verdade mostra (tem precedência sobre `telas["moto/fila"]`). */
  fila?: FilaFalsa;
  /** Telas da área logada, por caminho (`moto/`, `moto/status`, `moto/fila`…). */
  telas?: Record<string, string>;
  /** A conta principal mostra um ponto por vez (tela “Trocar Ponto”). */
  escolha?: EscolhaFalsa;
  /** A aba “Ticket” da conta principal (sem isto, a aba é só uma tela de texto). */
  tickets?: TicketFalso;
  /** Tudo responde 503 (portal fora do ar). */
  foraDoAr?: boolean;
  /** A tela de login traz captcha. */
  captcha?: boolean;
  /**
   * Quem chega com o cookie de uma sessão que o portal já encerrou recebe um
   * cookie de visitante novo na mesma resposta (como um PHP que troca o
   * identificador da sessão vencida).
   */
  trocaCookieDeSessaoEncerrada?: boolean;
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

/** Código de ponto inventado: letra do livro + três dígitos. */
export const codigoFalso = (livro: string, numero: number) => `${livro}${String(numero).padStart(3, "0")}`;

/** Quadro com os números dados, na ordem (o tipo de cada linha é só enfeite). */
export function quadroFalso(livro: string, ultimo: number | null, numeros: number[], tipo = "CAVALO TRUCADO"): QuadroFalso {
  return {
    ultimo: ultimo === null ? null : codigoFalso(livro, ultimo),
    pontos: numeros.map((n) => ({ codigo: codigoFalso(livro, n), tipo })),
  };
}

/**
 * A “Tela de Ativos” do portal, como nas telas enviadas pelo dono do app: as
 * abas de livro, o aviso do ponto da conta e um cartão por quadro, com o
 * último ponto escalado, a tabela SEQ / PONTO / TIPO e o “Total”.
 */
export function telaAtivos(fila: FilaFalsa, livro: "A" | "B" | "M"): string {
  const forma = fila.forma ?? "tabela";
  const linha = (i: number, p: { codigo: string; tipo: string }) =>
    forma === "tabela"
      ? `<tr><td>${i + 1}</td><td>${p.codigo}</td><td>${p.tipo}</td></tr>`
      : forma === "linhas"
        ? `<div class="linha"><span>${i + 1}</span> <span>${p.codigo}</span> <span>${p.tipo}</span></div>`
        : `<div>${i + 1}</div><div>${p.codigo}</div><div>${p.tipo}</div>`;
  const tabela = (q: QuadroFalso) =>
    forma === "tabela"
      ? `<table><thead><tr><th>SEQ</th><th>PONTO</th><th>TIPO</th></tr></thead><tbody>\n${q.pontos.map((p, i) => linha(i, p)).join("\n")}\n</tbody></table>`
      : `<div class="tabela"><div class="cab">${forma === "linhas" ? "<span>SEQ</span> <span>PONTO</span> <span>TIPO</span>" : "<div>SEQ</div><div>PONTO</div><div>TIPO</div>"}</div>\n${q.pontos.map((p, i) => linha(i, p)).join("\n")}\n</div>`;
  const cartao = (nome: string, q: QuadroFalso) => `<section class="cartao">
<h2>Livro ${livro} - ${nome}</h2>
<div class="ultimo"><span class="rotulo">ÚLTIMO PONTO ESCALADO</span><strong>${q.ultimo ?? "—"}</strong></div>
${tabela(q)}
${fila.semTotal ? "" : `<p class="total">Total: ${q.pontos.length}</p>`}
</section>`;
  const quadros = fila.livros[livro];
  const corpo = quadros
    ? [fila.semCartao === "truck" ? "" : cartao("Truck", quadros.truck), fila.semCartao === "carreta" ? "" : cartao("Carreta", quadros.carreta)]
        .filter(Boolean)
        .join("\n")
    : `<p>Nenhum ponto ativo neste livro.</p>`;
  const pagina = `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Fila</title></head><body>
<h1>Tela de Ativos</h1>
<div class="livros">${(["A", "B", "M"] as const)
    .map((l) => `<a class="aba${l === livro ? " ativa" : ""}" href="/moto/fila?livro=${l}">Livro ${l}</a>`)
    .join("")}</div>
<div class="aviso">Seu ponto (${fila.pontoDaConta ?? "A777"}) não está na fila deste livro no momento.</div>
${corpo}
${MENU_FALSO}
${RODAPE_FALSO}<script src="assets/app.js"></script></body></html>`;
  if (!fila.cortada) return pagina;
  // Resposta pela metade: para no meio da última linha da Carreta (sem o Total
  // dela e sem o fim da página).
  const ultimo = quadros?.carreta.pontos.at(-1)?.codigo;
  const corte = ultimo ? pagina.lastIndexOf(ultimo) : -1;
  return corte > 0 ? pagina.slice(0, corte) : pagina.slice(0, Math.floor(pagina.length / 2));
}

export const TELA_TICKET_FALSA = `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Ticket</title></head><body>
${MENU_FALSO}
<h1>Ticket</h1><p>Nenhum ticket emitido hoje.</p>
${RODAPE_FALSO}</body></html>`;

/** Valor que a lista de pontos envia para a opção `i` (o portal de verdade deve usar um número interno). */
export const valorDoPontoFalso = (i: number) => String(501 + i);
/** Valor que a lista de semanas envia: o primeiro dia, em aaaa-mm-dd. */
export const valorDaSemanaFalsa = (semana: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(semana);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : semana;
};

/** Tela “2ª Via de Ticket”: as duas listas e o botão “Gerar”. */
export function telaTicket(t: TicketFalso, codigoOculto?: string): string {
  const marcada = t.marcada ?? 0;
  const listas = `<label for="p">PONTO</label>
  <select id="p" name="${t.campoPonto ?? "id_ponto"}">${t.pontos.map((c, i) => `<option value="${valorDoPontoFalso(i)}"${i === 0 ? " selected" : ""}>${c}</option>`).join("")}</select>
  <label for="s">SEMANA</label>
  <select id="s" name="${t.campoSemana ?? "semana"}">${t.semanas.map((s, i) => `<option value="${valorDaSemanaFalsa(s)}"${i === marcada ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  const corpo = t.semFormulario
    ? `<div class="card"><h2>Selecione o período</h2>${listas}<button type="button" onclick="gerar()">Gerar</button></div>
<script>function gerar(){ /* a tela de verdade poderia enviar por JavaScript */ }</script>`
    : `<form class="card" method="${(t.metodo ?? "POST").toLowerCase()}" action="${t.acao ?? "ticket_lista.php"}">
  <h2>Selecione o período</h2>
  ${codigoOculto ? `<input type="hidden" name="_token" value="${codigoOculto}">` : ""}
  ${listas}
  ${t.comCampoDeTexto ? '<input type="text" name="observacao">' : ""}
  <button type="submit"${t.botaoComNome ? ' name="gerar" value="1"' : ""}>Gerar</button>
</form>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Ticket</title></head><body>
<header><img alt="COPADUBO"></header>
<h1>2ª Via de Ticket</h1>
${corpo}
${MENU_FALSO}
${RODAPE_FALSO}</body></html>`;
}

/** Tela “Tickets”: o que o “Gerar” mostra para um ponto e uma semana. */
export function telaTickets(t: TicketFalso, iPonto: number, iSemana: number): string {
  const semana = t.semanas[t.mostraSemana ?? iSemana] ?? "";
  const codigo = t.mostraPonto ?? t.pontos[iPonto] ?? "";
  const linhas = t.lancamentos[`${iPonto}|${iSemana}`] ?? [];
  const celulas = (l: LancamentoFalso) => [codigo, l.quant, l.valor, l.servico, ...(t.quatroColunas ? [] : [l.data, l.hora])];
  const cabecalho = ["PONTO", "QUANT", "VALOR", "SERVIÇO", ...(t.quatroColunas ? [] : ["DATA", "HORA"])];
  const vazio = "Nenhum lançamento encontrado para este período.";
  const forma = t.forma ?? "tabela";
  let quadro: string;
  if (forma === "tabela") {
    quadro = `<table><thead><tr>${cabecalho.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>
${linhas.length ? linhas.map((l) => `<tr>${celulas(l).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n") : `<tr><td colspan="6">${vazio}</td></tr>`}
</tbody></table>`;
  } else if (forma === "linhas") {
    quadro = `<div class="cab">${cabecalho.join(" ")}</div>
${linhas.length ? linhas.map((l) => `<div class="linha">${celulas(l).join(" ")}</div>`).join("\n") : `<p>${vazio}</p>`}`;
  } else {
    quadro = `<div class="grade">${cabecalho.map((c) => `<div class="cab">${c}</div>`).join("")}
${linhas.length ? linhas.map((l) => celulas(l).map((c) => `<div>${c}</div>`).join("")).join("\n") : `<p>${vazio}</p>`}</div>`;
  }
  const toneladas = linhas.reduce((s, l) => s + Number(l.quant.replace(",", ".")), 0);
  const total = t.comTotal ? `<p class="total">TOTAL GERAL: ${linhas.length + (t.totalErrado ? 1 : 0)} VIAGENS - ${toneladas.toFixed(3)}${t.quatroColunas ? "" : " TONS"}</p>` : "";
  const pagina = `<!doctype html><html><head><meta charset="utf-8"><title>Portal - Tickets</title></head><body>
<header><img alt="COPADUBO"></header>
<h1>Tickets</h1>
<div class="card">${t.semPeriodo ? "" : `<div><span>Período</span> <strong>${semana}</strong></div>`}
  <a class="botao" href="/moto/ticket_pdf.php?p=${valorDoPontoFalso(iPonto)}&s=${valorDaSemanaFalsa(semana)}" target="_blank">Gerar PDF</a></div>
<div class="card"><h2>Lançamentos</h2>
${quadro}
${total}</div>
${MENU_FALSO}
${RODAPE_FALSO}</body></html>`;
  if (!t.cortada) return pagina;
  // Corta no meio da última linha (ou, sem linhas, antes do aviso de vazio).
  const marca = linhas.length ? linhas[linhas.length - 1].data : vazio;
  const corte = pagina.lastIndexOf(marca);
  return corte > 0 ? pagina.slice(0, corte) : pagina.slice(0, Math.floor(pagina.length / 2));
}

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
    /** A aba “Fila” (igual para todas as contas); o teste pode mudar a fila entre as leituras. */
    fila: opcoes.fila,
    /** A aba “Ticket” da conta principal; o teste pode mudar as viagens entre as leituras. */
    tickets: opcoes.tickets,
    /** Consultas de ticket recebidas (“Gerar”), na ordem: `A032 2026-11-09`. */
    consultasDeTicket: [] as string[],
    /** Consultas de ticket recusadas (código escondido errado, ponto ou semana que não existem). */
    ticketsRecusados: 0,
    /** Demais contas, por CPF. */
    contas: Object.fromEntries(
      Object.entries(opcoes.contas ?? {}).map(([c, conta]) => [
        c,
        { senha: conta.senha, telas: { ...telasPadrao(), ...(conta.telas ?? {}) }, escolha: conta.escolha, tickets: conta.tickets },
      ]),
    ) as Record<string, { senha: string; telas: Record<string, string>; escolha?: EscolhaFalsa; tickets?: TicketFalso }>,
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
  /** Código escondido (uso único) do formulário do Ticket, por sessão. */
  const codigosDoTicket = new Map<string, string>();
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
    // “Gerar PDF”: o leitor nunca pode abrir.
    if (/pdf/i.test(caminho)) {
      estado.acoes.push(caminho);
      return { status: 200, corpo: "%PDF-1.4 de mentira" };
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
      const tk = dono === cpf ? estado.tickets : estado.contas[dono]?.tickets;
      if (tk) {
        if (caminho === "moto/ticket") {
          let codigo: string | undefined;
          if (tk.comCodigoOculto) {
            codigo = `tq${++serie}x`;
            codigosDoTicket.set(sessao, codigo);
          }
          return { status: 200, corpo: telaTicket(tk, codigo) };
        }
        if (caminho === `moto/${tk.acao ?? "ticket_lista.php"}`) {
          if (metodo !== (tk.metodo ?? "POST")) return { status: 302, cabecalhos: { location: "/moto/ticket" } };
          const campos = metodo === "POST" ? new URLSearchParams(corpo) : url.searchParams;
          const iPonto = Number(campos.get(tk.campoPonto ?? "id_ponto")) - 501;
          const iSemana = tk.semanas.findIndex((s) => valorDaSemanaFalsa(s) === campos.get(tk.campoSemana ?? "semana"));
          const codigoCerto = !tk.comCodigoOculto || (campos.get("_token") ?? "") === codigosDoTicket.get(sessao);
          const botaoCerto = !tk.botaoComNome || campos.get("gerar") === "1";
          codigosDoTicket.delete(sessao);
          if (!Number.isInteger(iPonto) || !tk.pontos[iPonto] || iSemana < 0 || !codigoCerto || !botaoCerto) {
            estado.ticketsRecusados += 1;
            return { status: 302, cabecalhos: { location: "/moto/ticket" } };
          }
          estado.consultasDeTicket.push(`${tk.pontos[iPonto]} ${valorDaSemanaFalsa(tk.semanas[iSemana])}`);
          return { status: 200, corpo: telaTickets(tk, iPonto, iSemana) };
        }
      }
      if (caminho === "moto/fila" && estado.fila) {
        const pedido = (url.searchParams.get("livro") ?? "").toUpperCase();
        const livro = pedido === "A" || pedido === "B" || pedido === "M" ? pedido : (estado.fila.padrao ?? "A");
        return { status: 200, corpo: telaAtivos(estado.fila, livro) };
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
      const sessaoEncerrada = Boolean(sessao) && !estado.sessoes.has(sessao) && !visitantes.has(sessao);
      if (r.cookie) cabecalhos.append("set-cookie", r.cookie);
      else if ((!sessao || (opcoes.trocaCookieDeSessaoEncerrada && sessaoEncerrada)) && !estado.foraDoAr) {
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
