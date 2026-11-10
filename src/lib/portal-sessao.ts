/**
 * SESSÃO HTTP do Portal do Motorista (`portal.copadubo.com.br`).
 *
 * Por que existe: o portal é um PHP com sessão por cookie. Entrar nele é uma
 * sequência de redirecionamentos (`/moto/` → `../login.php` → `/login`), e o
 * cookie de sessão pode ser criado ou TROCADO em qualquer um desses saltos —
 * inclusive no 302 da resposta do login. O `fetch` com `redirect: "follow"` só
 * mostra os cabeçalhos da última resposta: o cookie novo se perde e a página
 * seguinte volta para o login, como se a senha estivesse errada.
 *
 * Aqui cada salto é seguido À MÃO, como um navegador faz:
 *   - todo `Set-Cookie` de todo salto entra no pote da sessão;
 *   - `Location` relativo é resolvido contra o endereço do salto;
 *   - 301/302/303 depois de um POST viram GET (o login não é reenviado);
 *   - o pedido NUNCA sai do site do portal: se o portal mandar para outro
 *     endereço, a leitura para (o cookie da sessão não vai para terceiros).
 *
 * Só rede: nada de banco, nada de credencial. O CPF e a senha passam por aqui
 * apenas dentro do corpo do POST do login e nunca entram em mensagem de erro.
 */

/** Prazo de cada pedido. */
export const PRAZO_PEDIDO_MS = 6_000;
/** Prazo de uma visita inteira (login + telas): cabe com folga nos 60 s do cron. */
export const PRAZO_SESSAO_MS = 22_000;
const MAX_SALTOS = 8;
/** Uma página do portal tem poucos KB; isto só impede uma resposta absurda. */
const MAX_CARACTERES = 600_000;

const AGENTE =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

export type RespostaPortal = {
  /** Chegou uma resposta HTTP final (com qualquer status). */
  ok: boolean;
  status: number;
  /** Endereço FINAL, depois dos redirecionamentos. */
  url: string;
  html: string;
  /** Quantos redirecionamentos foram seguidos. */
  saltos: number;
  /** Falha de rede, laço de redirecionamento ou saída do site (nunca tem segredo). */
  erro: string | null;
};

export type PedidoPortal = {
  metodo?: "GET" | "POST";
  /** Corpo `application/x-www-form-urlencoded` (só no POST). */
  corpo?: string;
  referer?: string;
};

/** Resolve um endereço relativo; devolve `null` quando não é um endereço válido. */
function resolver(base: string, alvo: string): string | null {
  try {
    return new URL(alvo.trim(), base).toString();
  } catch {
    return null;
  }
}

/**
 * Texto da resposta na codificação que o servidor informa. PHP antigo ainda
 * responde em ISO-8859-1: lido como UTF-8, “ÚLTIMO” e “NÃO” virariam sujeira.
 */
async function lerTexto(resposta: Response): Promise<string> {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(resposta.headers.get("content-type") ?? "")?.[1]?.toLowerCase();
  try {
    if (charset && charset !== "utf-8" && charset !== "utf8") {
      return new TextDecoder(charset).decode(await resposta.arrayBuffer());
    }
    return await resposta.text();
  } catch {
    return "";
  }
}

export class SessaoPortal {
  private readonly cookies = new Map<string, string>();
  private readonly origem: URL | null;
  private readonly limiteAte: number;
  /** Pedidos feitos nesta sessão (para o diagnóstico e para os testes). */
  pedidos = 0;

  constructor(
    private readonly buscar: typeof fetch,
    base: string,
    opcoes: { prazoTotalMs?: number } = {},
  ) {
    try {
      this.origem = new URL(base);
    } catch {
      this.origem = null;
    }
    this.limiteAte = Date.now() + (opcoes.prazoTotalMs ?? PRAZO_SESSAO_MS);
  }

  /** O endereço pertence ao portal (mesmo servidor; http só pode subir para https). */
  mesmoSite(url: string): boolean {
    if (!this.origem) return false;
    try {
      const u = new URL(url);
      if (u.hostname !== this.origem.hostname || u.port !== this.origem.port) return false;
      return u.protocol === this.origem.protocol || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  /** A sessão já recebeu algum cookie do portal. */
  temCookies(): boolean {
    return this.cookies.size > 0;
  }

  private cabecalhoCookie(): string {
    return [...this.cookies.entries()].map(([nome, valor]) => `${nome}=${valor}`).join("; ");
  }

  private guardarCookies(resposta: Response) {
    const recebidos =
      typeof resposta.headers.getSetCookie === "function"
        ? resposta.headers.getSetCookie()
        : resposta.headers.get("set-cookie")
          ? [resposta.headers.get("set-cookie") as string]
          : [];
    for (const bruto of recebidos) {
      const partes = bruto.split(";");
      const primeiro = partes[0]?.trim() ?? "";
      const i = primeiro.indexOf("=");
      if (i <= 0) continue;
      const nome = primeiro.slice(0, i).trim();
      const valor = primeiro.slice(i + 1).trim();
      const atributos = partes.slice(1).map((p) => p.trim().toLowerCase());
      const idade = atributos.find((a) => a.startsWith("max-age="));
      const expira = atributos.find((a) => a.startsWith("expires="));
      const vencido =
        (idade !== undefined && Number(idade.slice(8)) <= 0) ||
        (expira !== undefined && Number.isFinite(Date.parse(expira.slice(8))) && Date.parse(expira.slice(8)) < Date.now());
      // O PHP encerra uma sessão mandando `PHPSESSID=deleted` com data vencida.
      if (vencido || valor === "" || valor === "deleted") this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }
  }

  private falha(erro: string, url: string, saltos: number): RespostaPortal {
    return { ok: false, status: 0, url, html: "", saltos, erro };
  }

  /**
   * Pede uma página do portal seguindo os redirecionamentos com os cookies da
   * sessão. Nunca lança: a falha volta descrita em `erro`.
   */
  async pedir(url: string, pedido: PedidoPortal = {}): Promise<RespostaPortal> {
    let atual = url;
    let metodo: "GET" | "POST" = pedido.metodo ?? "GET";
    let corpo = pedido.corpo;
    let referer = pedido.referer;

    for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
      if (!this.mesmoSite(atual)) {
        return this.falha(
          salto === 0
            ? "O endereço do portal é inválido (confira PORTAL_MOTORISTA_URL)."
            : "O portal redirecionou para outro site; a leitura foi interrompida.",
          atual,
          salto,
        );
      }
      const restante = this.limiteAte - Date.now();
      if (restante <= 0) return this.falha("Tempo esgotado para ler o portal.", atual, salto);

      const cookie = this.cabecalhoCookie();
      let resposta: Response;
      try {
        resposta = await this.buscar(atual, {
          method: metodo,
          redirect: "manual",
          cache: "no-store",
          headers: {
            "user-agent": AGENTE,
            accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "accept-language": "pt-BR,pt;q=0.9",
            ...(cookie ? { cookie } : {}),
            ...(referer ? { referer } : {}),
            ...(metodo === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          },
          ...(metodo === "POST" ? { body: corpo ?? "" } : {}),
          signal: AbortSignal.timeout(Math.max(500, Math.min(PRAZO_PEDIDO_MS, restante))),
        });
      } catch (e) {
        const nome = e instanceof Error ? e.name : "";
        const texto = e instanceof Error ? e.message : String(e);
        return this.falha(
          nome === "TimeoutError" || nome === "AbortError"
            ? "o portal demorou demais para responder"
            : texto.slice(0, 120),
          atual,
          salto,
        );
      }
      this.pedidos += 1;
      this.guardarCookies(resposta);

      const destino = resposta.headers.get("location");
      if (resposta.status >= 300 && resposta.status < 400 && destino) {
        await resposta.body?.cancel().catch(() => undefined);
        const proximo = resolver(atual, destino);
        if (!proximo) return this.falha("O portal mandou um redirecionamento inválido.", atual, salto);
        // Como no navegador: depois de 301/302/303 o POST vira GET (o login não
        // é reenviado); 307/308 repetem o mesmo pedido.
        if (resposta.status === 303 || ((resposta.status === 301 || resposta.status === 302) && metodo === "POST")) {
          metodo = "GET";
          corpo = undefined;
        }
        referer = atual;
        atual = proximo;
        continue;
      }

      const html = (await lerTexto(resposta)).slice(0, MAX_CARACTERES);
      return { ok: true, status: resposta.status, url: atual, html, saltos: salto, erro: null };
    }
    return this.falha("O portal redirecionou vezes demais.", atual, MAX_SALTOS);
  }
}
