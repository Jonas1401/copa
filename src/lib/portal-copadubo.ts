import { createHash } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { comBanco, temBancoConfigurado } from "@/db";
import { db } from "@/db";
import { motoristas, portalLeituras, portalMotoristaAcessos } from "@/db/schema";
import { cifrarParaColuna, decifrarDeColuna } from "@/lib/admin/segredos";
import { enviarPush } from "@/lib/push";
import {
  analisarPortal,
  cpfPlausivel,
  escolherFormularioLogin,
  extrairSecoes,
  hashConteudo,
  limparCpf,
  linhasAlteradas,
  montarCorpoLogin,
  resolverUrl,
  type SecaoPortal,
} from "@/lib/portal-copadubo-parse";

/**
 * Monitoramento do PORTAL DO MOTORISTA da Copadubo (`portal.copadubo.com.br`).
 *
 * O motorista cadastra o PRÓPRIO CPF e a senha dentro do aplicativo. Os dois
 * ficam cifrados (AES-256-GCM, mesma chave mestra do cofre de API Keys) e são
 * usados por ESTE módulo apenas para:
 *   1. abrir a página de login e descobrir sozinhos os nomes dos campos;
 *   2. entrar e ler a página de status;
 *   3. transformar a página em seções/linhas (leitura genérica);
 *   4. guardar um resumo por leitura e avisar o motorista quando algo muda.
 *
 * Regras de segurança que este arquivo NÃO abre exceção:
 *   - a senha nunca é devolvida para o navegador, nem para o /admin (só o CPF
 *     mascarado e os 4 últimos caracteres da senha);
 *   - a senha nunca vai para log, auditoria, aviso ou IA;
 *   - o conteúdo lido é do PRÓPRIO motorista e só ele (e o administrador,
 *     para diagnóstico) vê;
 *   - cada leitura é um login novo (nada de cookie reaproveitado em disco).
 */

export const PORTAL_BASE = "https://portal.copadubo.com.br";
/** Página que o motorista vê depois de entrar (a mesma do pedido do app). */
export const PORTAL_STATUS = `${PORTAL_BASE}/moto/status.php`;
export const PORTAL_LOGIN = `${PORTAL_BASE}/login`;

/** Prazos curtos: a função serverless da Vercel Hobby tem 10 s. */
const PRAZO_ENVIO_MS = 6_000;
/** Intervalo mínimo entre leituras do mesmo motorista (o cron roda 1×/min). */
export const INTERVALO_LEITURA_MS = 5 * 60_000;
/** Tavily de avisos: no máximo 6 por hora e 20 por dia, por motorista. */
const AVISO_MIN_MS = 10 * 60_000;
const AVISO_MAX_HORA = 6;
const AVISO_MAX_DIA = 20;

const AGENTE =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

/** Endereço do portal, trocável por ambiente (teste/homologação). */
export function urlPortal(caminho = "status.php"): string {
  const base = (process.env.PORTAL_MOTORISTA_URL ?? PORTAL_BASE).replace(/\/+$/, "");
  if (!caminho) return base;
  return `${base}/${caminho.replace(/^\/+/, "")}`;
}

export type CredenciaisPortal = { cpf: string; senha: string };

export type LeituraPortal = {
  ok: boolean;
  /** O portal recusou o login (CPF/senha). */
  loginRecusado: boolean;
  /** O portal pediu captcha: não dá para entrar por HTTP. */
  captcha: boolean;
  /** A página de status voltou mas veio vazia/incompleta. */
  vazia: boolean;
  statusHttp: number | null;
  urlFinal: string | null;
  titulo: string;
  secoes: SecaoPortal[];
  totalLinhas: number;
  hash: string;
  /** Linhas que falam do dia a dia (chamada, fila, status…). */
  sinais: string[];
  /** Linhas que mudaram em relação à leitura anterior. */
  novas: string[];
  /** Falhou nesta leitura E na anterior: vale avisar (não é piscada). */
  avisoPreciso: boolean;
  removidas: string[];
  /** Diagnóstico legível (nunca inclui CPF, senha ou cookies). */
  diagnostico: string[];
  ms: number;
  /** Conteúdo da página só para IA/administrador (não vai para o celular). */
  texto: string;
};

export type ResultadoLogin = { ok: true; html: string; url: string; cookies: string } | { ok: false; leitura: LeituraPortal };

/** `fetch` que nunca lança: devolve a resposta ou o erro (para virar diagnóstico). */
async function buscarSeguro(
  buscar: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response | Error> {
  try {
    return await buscar(url, init);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

function leituraFalha(motivo: string, extra: Partial<LeituraPortal> = {}): LeituraPortal {
  return {
    ok: false,
    loginRecusado: false,
    captcha: false,
    vazia: false,
    statusHttp: null,
    urlFinal: null,
    titulo: "",
    secoes: [],
    totalLinhas: 0,
    hash: "",
    sinais: [],
    novas: [],
    removidas: [],
    avisoPreciso: true,
    diagnostico: [motivo],
    ms: 0,
    texto: "",
    ...extra,
  };
}

/** Cookies de `Set-Cookie` (só o par nome=valor, sem atributos). */
function juntarCookies(resposta: Response, anteriores = ""): string {
  const jar = new Map<string, string>();
  for (const par of anteriores.split(/;\s*/).filter(Boolean)) {
    const i = par.indexOf("=");
    if (i > 0) jar.set(par.slice(0, i), par.slice(i + 1));
  }
  const recebidos = typeof resposta.headers.getSetCookie === "function"
    ? resposta.headers.getSetCookie()
    : (resposta.headers.get("set-cookie") ? [resposta.headers.get("set-cookie") as string] : []);
  for (const bruto of recebidos) {
    const primeiro = bruto.split(";")[0]?.trim();
    if (!primeiro) continue;
    const i = primeiro.indexOf("=");
    if (i > 0) jar.set(primeiro.slice(0, i), primeiro.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const pareceErroDeCredencial = (html: string) =>
  /senha\s+(inv[áa]lida|incorreta)|usu[áa]rio\s+(inv[áa]lido|n[ãa]o)|login\s+inv[áa]lido|dados\s+incorretos|cpf\s+ou\s+senha|credenciais|n[ãa]o\s+encontrad|falha\s+no\s+login|e-?mail\s+ou\s+cpf/i.test(
    html.replace(/<[^>]+>/g, " "),
  );

/**
 * Entra no portal com CPF + senha e devolve a página de status.
 *
 * Passos: GET na página que o motorista usa (que redireciona ao login) →
 * descobre o formulário pelo campo de senha → POST com os nomes REAIS dos
 * campos → confere se a resposta ainda é a tela de login.
 */
export async function entrarNoPortal(
  credenciais: CredenciaisPortal,
  opcoes: { buscar?: typeof fetch; inicio?: string } = {},
): Promise<ResultadoLogin> {
  const buscar = opcoes.buscar ?? fetch;
  const inicio = opcoes.inicio ?? urlPortal();

  const pagina = await buscarSeguro(buscar, inicio, {
    redirect: "follow",
    headers: { "user-agent": AGENTE, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
  });

  if (pagina instanceof Error) {
    return { ok: false, leitura: leituraFalha(`Sem resposta do portal: ${pagina.message.slice(0, 120)}`) };
  }
  if (!pagina.ok && pagina.status >= 500) {
    return { ok: false, leitura: leituraFalha(`Portal respondeu ${pagina.status}.`, { statusHttp: pagina.status, urlFinal: pagina.url }) };
  }

  const htmlInicial = await pagina.text();
  const cookies = juntarCookies(pagina);
  const formulario = escolherFormularioLogin(htmlInicial);

  // A página do pedido às vezes já vem aberta (sessão pública): não força login.
  if (!formulario && !analisarPortal(htmlInicial).pareceLogin) {
    const analise = analisarPortal(htmlInicial);
    if (analise.totalLinhas > 0) {
      return { ok: true, html: htmlInicial, url: pagina.url, cookies };
    }
  }

  if (!formulario) {
    return { ok: false, leitura: leituraFalha("Não encontrei o formulário de login na página.", { statusHttp: pagina.status, urlFinal: pagina.url }) };
  }
  if (formulario.temCaptcha) {
    return {
      ok: false,
      leitura: leituraFalha("O portal pediu captcha neste acesso — a leitura automática não consegue passar por ele.", {
        captcha: true,
        avisoPreciso: false,
        statusHttp: pagina.status,
        urlFinal: pagina.url,
      }),
    };
  }
  const temUsuario = formulario.campos.some((c) => c.tipo !== "hidden" && !/senha|password|passwd/i.test(`${c.nome} ${c.id} ${c.rotulo}`));
  if (!temUsuario) {
    return { ok: false, leitura: leituraFalha("O formulário de login não tem campo de usuário reconhecível.", { urlFinal: pagina.url }) };
  }

  const acao = resolverUrl(pagina.url || inicio, formulario.action);
  const corpo = montarCorpoLogin(formulario, credenciais);
  const envio = await buscarSeguro(buscar, acao, {
    method: formulario.method === "post" ? "POST" : "POST",
    redirect: "follow",
    headers: {
      "user-agent": AGENTE,
      accept: "text/html,*/*",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookies ? { cookie: cookies } : {}),
      referer: pagina.url || inicio,
    },
    body: corpo.toString(),
    signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
  });

  if (envio instanceof Error) {
    return { ok: false, leitura: leituraFalha(`Envio do login falhou: ${envio.message.slice(0, 120)}`) };
  }

  const htmlDepois = await envio.text();
  const cookiesDepois = juntarCookies(envio, cookies);

  // Voltou com formulário de senha → a sessão não abriu (credencial recusada).
  // Sem formulário e com a página cheia, entrou de verdade: a mensagem de erro
  // só é considerada quando a página veio SEM conteúdo (evita falso positivo
  // de uma página logada que apenas fala de "senha" no menu).
  const formularioDepois = escolherFormularioLogin(htmlDepois);
  const analiseDepois = analisarPortal(htmlDepois);
  const erroNaPagina = pareceErroDeCredencial(htmlDepois);
  if (formularioDepois || (analiseDepois.totalLinhas === 0 && erroNaPagina)) {
    return {
      ok: false,
      leitura: leituraFalha(
        erroNaPagina || analiseDepois.totalLinhas === 0
          ? "O portal recusou o CPF/senha cadastrados."
          : "Depois do login o portal voltou para a tela de entrada (sessão não abriu).",
        { loginRecusado: true, avisoPreciso: false, statusHttp: envio.status, urlFinal: envio.url },
      ),
    };
  }

  // Entrou. Se o login levou para uma página sem conteúdo útil, busca o status.
  if (analiseDepois.totalLinhas === 0) {
    const status = await buscarSeguro(buscar, urlPortal(), {
      redirect: "follow",
      headers: { "user-agent": AGENTE, accept: "text/html,*/*", ...(cookiesDepois ? { cookie: cookiesDepois } : {}) },
      signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
    });
    if (status instanceof Error) {
      return { ok: false, leitura: leituraFalha(`Login ok, mas a página de status falhou: ${status.message.slice(0, 120)}`) };
    }
    const htmlStatus = await status.text();
    if (escolherFormularioLogin(htmlStatus)) {
      return {
        ok: false,
        leitura: leituraFalha("Entrou, mas a página de status pediu login de novo (sessão não persistiu).", { statusHttp: status.status, urlFinal: status.url }),
      };
    }
    return { ok: true, html: htmlStatus, url: status.url, cookies: juntarCookies(status, cookiesDepois) };
  }

  return { ok: true, html: htmlDepois, url: envio.url, cookies: cookiesDepois };
}

/**
 * Lê o portal de um motorista e devolve o resultado já comparado com a
 * leitura anterior (quando `anteriores` é informado).
 *
 * Não grava nada: quem chama decide (o cron grava em `portal_leituras`).
 */
export async function lerPortalDoMotorista(
  credenciais: CredenciaisPortal,
  anteriores: SecaoPortal[] = [],
  opcoes: { buscar?: typeof fetch } = {},
): Promise<LeituraPortal> {
  const inicio = Date.now();
  if (!cpfPlausivel(credenciais.cpf)) {
    return leituraFalha("CPF cadastrado não tem 11 dígitos válidos.");
  }
  if (!credenciais.senha || credenciais.senha.length < 3) {
    return leituraFalha("Senha do portal não cadastrada.");
  }

  const entrada = await entrarNoPortal(credenciais, opcoes);
  if (!entrada.ok) return { ...entrada.leitura, ms: Date.now() - inicio };

  const analise = analisarPortal(entrada.html);
  const vazia = analise.totalLinhas === 0;
  const anterior = anteriores.length ? anteriores : [];
  const { novas, removidas } = anterior.length ? linhasAlteradas(anterior, analise.secoes) : { novas: [], removidas: [] };

  return {
    ok: !vazia,
    loginRecusado: false,
    captcha: false,
    vazia,
    statusHttp: 200,
    urlFinal: entrada.url,
    titulo: analise.titulo,
    secoes: analise.secoes,
    totalLinhas: analise.totalLinhas,
    hash: hashConteudo(analise.secoes),
    sinais: analise.sinais,
    novas,
    removidas,
    avisoPreciso: false,
    diagnostico: [
      "Login aceito pelo portal.",
      `Página lida: ${analise.titulo || entrada.url}`,
      `${analise.secoes.length} seção(ões) · ${analise.totalLinhas} linha(s).`,
      anterior.length ? `${novas.length} linha(s) nova(s), ${removidas.length} removida(s).` : "Primeira leitura: nada é avisado ainda.",
    ],
    ms: Date.now() - inicio,
    texto: analise.secoes
      .map((s) => `# ${s.titulo}\n${s.linhas.map((l) => `- ${l}`).join("\n")}`)
      .join("\n")
      .slice(0, 6_000),
  };
}

// ------------------------------------------------------------------ banco

let tabelasProntas = false;

/** Cria as tabelas do monitoramento do portal (idempotente). */
export async function garantirTabelasPortal() {
  if (tabelasProntas || !temBancoConfigurado) return;
  await comBanco(() =>
    db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_motorista_acessos (
        motorista_id INTEGER PRIMARY KEY,
        cpf TEXT NOT NULL,
        cpf_final TEXT NOT NULL,
        senha_cifrada TEXT NOT NULL,
        senha_final4 TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        aceito_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS portal_leituras (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        login_recusado INTEGER NOT NULL DEFAULT 0,
        captcha INTEGER NOT NULL DEFAULT 0,
        status_http INTEGER,
        titulo TEXT,
        total_linhas INTEGER NOT NULL DEFAULT 0,
        secoes JSONB,
        sinais JSONB,
        hash TEXT,
        novas JSONB,
        removidas JSONB,
        diagnostico TEXT,
        ms INTEGER NOT NULL DEFAULT 0,
        avisado INTEGER NOT NULL DEFAULT 0,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portal_leituras_motorista_idx ON portal_leituras (motorista_id, id DESC);
      CREATE INDEX IF NOT EXISTS portal_leituras_criado_idx ON portal_leituras (criado_em);
    `),
  );
  tabelasProntas = true;
}

/** Total de motoristas que cadastraram o CPF/senha do portal. */
export async function totalAcessosPortal(): Promise<number> {
  if (!temBancoConfigurado) return 0;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db.select({ n: sql<number>`count(*)::int` }).from(portalMotoristaAcessos),
  );
  return linha?.n ?? 0;
}

/** Um acesso por motorista (o próprio motorista só vê o dele). */
export async function acessoPortalDoMotorista(motoristaId: number) {
  if (!temBancoConfigurado) return null;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db.select().from(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, motoristaId)).limit(1),
  );
  return linha ?? null;
}

export type AcessoPortalPublico = {
  cadastrado: boolean;
  cpfMascarado: string | null;
  senhaFinal4: string | null;
  ativo: boolean;
  desde: string | null;
  /** Última leitura guardada (o app mostra "Portal: lido há…"). */
  leitura: {
    ok: boolean;
    loginRecusado: boolean;
    captcha: boolean;
    titulo: string | null;
    totalLinhas: number;
    sinais: string[];
    quando: string | null;
    diagnostico: string | null;
  } | null;
};

/** Versão segura para o navegador: sem CPF completo, sem senha, sem URLs. */
export function acessoPublico(
  acesso: typeof portalMotoristaAcessos.$inferSelect | null,
  leitura: typeof portalLeituras.$inferSelect | null,
): AcessoPortalPublico {
  return {
    cadastrado: Boolean(acesso),
    cpfMascarado: acesso
      ? `***.***.${acesso.cpfFinal.slice(-3)}-${acesso.cpfFinal.slice(-2)}`
      : null,
    senhaFinal4: acesso?.senhaFinal4 ?? null,
    ativo: Boolean(acesso?.ativo),
    desde: acesso?.aceitoEm ? acesso.aceitoEm.toISOString() : null,
    leitura: leitura
      ? {
          ok: leitura.ok === 1,
          loginRecusado: leitura.loginRecusado === 1,
          captcha: leitura.captcha === 1,
          titulo: leitura.titulo,
          totalLinhas: leitura.totalLinhas,
          sinais: Array.isArray(leitura.sinais) ? (leitura.sinais as string[]) : [],
          quando: leitura.criadoEm.toISOString(),
          diagnostico: leitura.diagnostico,
        }
      : null,
  };
}

/** Última leitura de um motorista (a que o app mostra). */
export async function ultimaLeituraPortal(motoristaId: number) {
  if (!temBancoConfigurado) return null;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db
      .select()
      .from(portalLeituras)
      .where(eq(portalLeituras.motoristaId, motoristaId))
      .orderBy(desc(portalLeituras.id))
      .limit(1),
  );
  return linha ?? null;
}

/**
 * Guarda CPF (cifrado) + senha (cifrada) do portal para o motorista.
 * `trocouSenha=false` exige que já exista cadastro (evita criar dois).
 */
export async function salvarAcessoPortal(
  motoristaId: number,
  credenciais: CredenciaisPortal,
) {
  if (!temBancoConfigurado) throw new Error("Banco não configurado.");
  await garantirTabelasPortal();
  const cpf = limparCpf(credenciais.cpf);
  const senha = credenciais.senha;
  if (!cpfPlausivel(cpf)) throw new Error("CPF inválido: digite os 11 números.");
  if (!senha || senha.length < 3) throw new Error("Digite a senha do portal.");
  if (senha.length > 120) throw new Error("Senha longa demais (máximo 120 caracteres).");

  const cpfCifrado = await cifrarParaColuna(cpf);
  const senhaCifrada = await cifrarParaColuna(senha);
  const antes = await acessoPortalDoMotorista(motoristaId);

  await comBanco(() =>
    db
      .insert(portalMotoristaAcessos)
      .values({
        motoristaId,
        cpf: cpfCifrado,
        cpfFinal: cpf.slice(-5),
        senhaCifrada,
        senhaFinal4: senha.slice(-4),
        ativo: 1,
      })
      .onConflictDoUpdate({
        target: portalMotoristaAcessos.motoristaId,
        set: {
          cpf: cpfCifrado,
          cpfFinal: cpf.slice(-5),
          senhaCifrada,
          senhaFinal4: senha.slice(-4),
          ativo: 1,
          atualizadoEm: new Date(),
        },
      }),
  );
  return { substituiu: Boolean(antes) };
}

/** Remove o acesso do motorista (a senha dele sai do banco na hora). */
export async function removerAcessoPortal(motoristaId: number) {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  const apagados = await comBanco(() =>
    db.delete(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, motoristaId)).returning({ id: portalMotoristaAcessos.motoristaId }),
  );
  await comBanco(() => db.delete(portalLeituras).where(eq(portalLeituras.motoristaId, motoristaId)));
  return apagados.length > 0;
}

/** Abre as credenciais guardadas (uso exclusivo do servidor). */
async function credenciaisGuardadas(motoristaId: number): Promise<CredenciaisPortal | null> {
  const acesso = await acessoPortalDoMotorista(motoristaId);
  if (!acesso || acesso.ativo !== 1) return null;
  try {
    return {
      cpf: await decifrarDeColuna(acesso.cpf),
      senha: await decifrarDeColuna(acesso.senhaCifrada),
    };
  } catch {
    return null;
  }
}

/** A última leitura ANTES desta (para comparar o que mudou). */
async function leituraAnterior(motoristaId: number) {
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db
      .select({ secoes: portalLeituras.secoes })
      .from(portalLeituras)
      .where(and(eq(portalLeituras.motoristaId, motoristaId), eq(portalLeituras.ok, 1)))
      .orderBy(desc(portalLeituras.id))
      .limit(1),
  );
  const secoes = linha?.secoes;
  return Array.isArray(secoes) ? (secoes as SecaoPortal[]) : [];
}

/**
 * Lê o portal de UM motorista, grava a leitura e (quando algo muda) avisa.
 *
 * O aviso vai SÓ para os aparelhos daquele motorista, com tag própria
 * (uma alteração avisada não se repete) e respeitando a cota de 6/hora e
 * 20/dia — o portal pode piscar e não pode virar enxurrada de Push.
 */
export async function monitorarMotorista(
  motoristaId: number,
  opcoes: { buscar?: typeof fetch; forcar?: boolean; avisar?: boolean } = {},
) {
  const credenciais = await credenciaisGuardadas(motoristaId);
  if (!credenciais) return { rodou: false, motivo: "sem_acesso" as const };

  const anteriores = await leituraAnterior(motoristaId);
  // Quantas leituras SEGUIDAS falharam antes desta (para não gritar numa piscada).
  const falhasSeguidas = await contarFalhasSeguidas(motoristaId);
  const leitura = await lerPortalDoMotorista(credenciais, anteriores, { buscar: opcoes.buscar });

  await garantirTabelasPortal();
  const [gravada] = await comBanco(() =>
    db
      .insert(portalLeituras)
      .values({
        motoristaId,
        ok: leitura.ok ? 1 : 0,
        loginRecusado: leitura.loginRecusado ? 1 : 0,
        captcha: leitura.captcha ? 1 : 0,
        statusHttp: leitura.statusHttp,
        titulo: leitura.titulo.slice(0, 160),
        totalLinhas: leitura.totalLinhas,
        secoes: leitura.secoes,
        sinais: leitura.sinais,
        hash: leitura.hash,
        novas: leitura.novas,
        removidas: leitura.removidas,
        diagnostico: leitura.diagnostico.join("\n").slice(0, 600),
        ms: leitura.ms,
      })
      .returning({ id: portalLeituras.id, criadoEm: portalLeituras.criadoEm }),
  );

  // Só apaga histórico antigo deste motorista: 7 dias bastam para diagnóstico.
  await comBanco(() =>
    db.delete(portalLeituras).where(
      and(
        eq(portalLeituras.motoristaId, motoristaId),
        sql`${portalLeituras.criadoEm} < now() - interval '7 days'`,
      ),
    ),
  );

  let aviso: { enviado: boolean; motivo?: string } = { enviado: false };
  const mudou = leitura.ok && anteriores.length > 0 && leitura.novas.length > 0;
  const falhouDeNovo = !leitura.ok && anteriores.length > 0 && falhasSeguidas >= 2;
  const precisaAvisar =
    opcoes.avisar !== false && ((mudou && leitura.avisoPreciso) || (leitura.loginRecusado && falhasSeguidas > 0) || falhouDeNovo);

  if (precisaAvisar) {
    const liberado = await cotaDeAvisoLiberada(motoristaId);
    if (!liberado) {
      aviso = { enviado: false, motivo: "cota" };
    } else {
      const corpo = leitura.loginRecusado
        ? "O portal recusou o CPF/senha cadastrados. Abra o app em Portal do motorista e cadastre a senha de novo."
        : leitura.captcha
          ? "O portal pediu captcha e a leitura automática parou."
          : leitura.ok
            ? resumoAviso(leitura.novas)
            : "A leitura do portal falhou. Abra o app em Portal do motorista.";
      const r = await enviarPush(
        {
          title: leitura.loginRecusado ? "🔒 Portal: senha recusada" : leitura.ok ? "🚦 Portal do motorista: novidade" : "⚠️ Portal do motorista",
          body: corpo.slice(0, 180),
          tag: `PORTAL_${motoristaId}_${gravada?.id ?? Date.now()}`,
          acao: "portal",
          url: "/",
        },
        { motoristaId, unica: true },
      ).catch(() => null);
      aviso = { enviado: Boolean(r && r.enviadas > 0), ...(r && r.enviadas === 0 ? { motivo: "sem_aparelho" } : {}) };
      if (aviso.enviado) {
        await comBanco(() => db.update(portalLeituras).set({ avisado: 1 }).where(eq(portalLeituras.id, gravada!.id)));
      }
    }
  }

  return {
    rodou: true,
    ok: leitura.ok,
    loginRecusado: leitura.loginRecusado,
    captcha: leitura.captcha,
    linhas: leitura.totalLinhas,
    novas: leitura.novas,
    diagnostico: leitura.diagnostico,
    aviso,
    leituraId: gravada?.id ?? null,
    quando: gravada?.criadoEm?.toISOString() ?? new Date().toISOString(),
  };
}

/** Primeira linha nova, curta, para o corpo do aviso. */
function resumoAviso(novas: string[]): string {
  const principal = novas.slice(0, 3).join(" · ");
  return principal ? `Mudou no portal: ${principal}` : "O portal do motorista foi atualizado.";
}

/**
 * Cota de avisos do portal: 6 por hora e 20 por dia, por motorista, e nunca
 * dois avisos com menos de `AVISO_MIN_MS` de distância. A contagem usa o campo
 * `avisado` (só as leituras que REALMENTE geraram Push).
 */
async function cotaDeAvisoLiberada(motoristaId: number): Promise<boolean> {
  const [c] = await comBanco(() =>
    db
      .select({
        hora: sql<number>`count(*) filter (where ${portalLeituras.criadoEm} > now() - interval '1 hour')::int`,
        dia: sql<number>`count(*) filter (where ${portalLeituras.criadoEm} > now() - interval '1 day')::int`,
        ultimo: sql<Date | null>`max(${portalLeituras.criadoEm})`,
      })
      .from(portalLeituras)
      .where(and(eq(portalLeituras.motoristaId, motoristaId), eq(portalLeituras.avisado, 1))),
  );
  if (!c) return true;
  if ((c.hora ?? 0) >= AVISO_MAX_HORA) return false;
  if ((c.dia ?? 0) >= AVISO_MAX_DIA) return false;
  if (c.ultimo && Date.now() - new Date(c.ultimo).getTime() < AVISO_MIN_MS) return false;
  return true;
}

/** Resumo para o cartão do /admin: quem cadastrou, quem leu, quem falhou. */
export async function painelPortalAdmin() {
  if (!temBancoConfigurado) {
    return { total: 0, ativos: 0, lidos24h: 0, falhas: 0, comAcesso: 0, atualizadoEm: null as string | null, motoristas: [] as PainelMotoristaPortal[] };
  }
  await garantirTabelasPortal();
  const acessos = await comBanco(() =>
    db
      .select({
        motoristaId: portalMotoristaAcessos.motoristaId,
        nome: motoristas.nome,
        cpfFinal: portalMotoristaAcessos.cpfFinal,
        senhaFinal4: portalMotoristaAcessos.senhaFinal4,
        ativo: portalMotoristaAcessos.ativo,
        aceitoEm: portalMotoristaAcessos.aceitoEm,
        atualizadoEm: portalMotoristaAcessos.atualizadoEm,
      })
      .from(portalMotoristaAcessos)
      .leftJoin(motoristas, eq(motoristas.id, portalMotoristaAcessos.motoristaId))
      .orderBy(asc(portalMotoristaAcessos.motoristaId)),
  );

  const ultimas = await comBanco(() =>
    db
      .select({
        motoristaId: portalLeituras.motoristaId,
        id: portalLeituras.id,
        ok: portalLeituras.ok,
        loginRecusado: portalLeituras.loginRecusado,
        captcha: portalLeituras.captcha,
        totalLinhas: portalLeituras.totalLinhas,
        titulo: portalLeituras.titulo,
        sinais: portalLeituras.sinais,
        diagnostico: portalLeituras.diagnostico,
        ms: portalLeituras.ms,
        criadoEm: portalLeituras.criadoEm,
        secoes: portalLeituras.secoes,
      })
      .from(portalLeituras)
      .where(
        sql`${portalLeituras.id} in (select max(id) from portal_leituras group by motorista_id)`,
      )
      .orderBy(desc(portalLeituras.id)),
  );

  const porMotorista = new Map(ultimas.map((l) => [l.motoristaId, l]));
  const lista: PainelMotoristaPortal[] = acessos.map((a) => {
    const l = porMotorista.get(a.motoristaId) ?? null;
    return {
      motoristaId: a.motoristaId,
      nome: a.nome ?? `Motorista #${a.motoristaId}`,
      cpfMascarado: `***.***.${a.cpfFinal.slice(-3)}-${a.cpfFinal.slice(-2)}`,
      senhaFinal4: a.senhaFinal4,
      ativo: a.ativo === 1,
      desde: a.aceitoEm?.toISOString() ?? null,
      ultima: l
        ? {
            em: l.criadoEm.toISOString(),
            ok: l.ok === 1,
            loginRecusado: l.loginRecusado === 1,
            captcha: l.captcha === 1,
            linhas: l.totalLinhas,
            titulo: l.titulo,
            ms: l.ms,
            sinais: Array.isArray(l.sinais) ? (l.sinais as string[]) : [],
            diagnostico: (l.diagnostico ?? "").split("\n").filter(Boolean),
            secoes: Array.isArray(l.secoes) ? (l.secoes as SecaoPortal[]) : [],
          }
        : null,
    };
  });

  const agora = Date.now();
  const lidos24h = ultimas.filter((l) => agora - new Date(l.criadoEm).getTime() < 24 * 3_600_000 && l.ok === 1).length;
  const falhas = lista.filter((m) => m.ultima && (!m.ultima.ok || m.ultima.loginRecusado)).length;

  return {
    total: lista.length,
    ativos: lista.filter((m) => m.ativo).length,
    comAcesso: lista.length,
    lidos24h,
    falhas,
    atualizadoEm: new Date().toISOString(),
    motoristas: lista,
  };
}

export type PainelMotoristaPortal = {
  motoristaId: number;
  nome: string;
  cpfMascarado: string;
  senhaFinal4: string;
  ativo: boolean;
  desde: string | null;
  ultima: {
    em: string;
    ok: boolean;
    loginRecusado: boolean;
    captcha: boolean;
    linhas: number;
    titulo: string | null;
    ms: number;
    sinais: string[];
    diagnostico: string[];
    secoes: SecaoPortal[];
  } | null;
};

/**
 * Uma rodada do monitoramento para TODOS os motoristas com acesso ativo.
 * O cron chama isto; a fila da Copadubo continua no caminho dela.
 * Cada motorista tem `INTERVALO_LEITURA_MS` de folga, para o portal não ser
 * martelado a cada minuto.
 */
export async function monitorarTodos(limite = 3, prazoMs = 25_000) {
  const inicio = Date.now();
  if (!temBancoConfigurado) return { motoristas: 0, lidos: 0, falhas: 0, avisos: 0 };
  await garantirTabelasPortal();
  const acessiveis = await comBanco(() =>
    db
      .select({ motoristaId: portalMotoristaAcessos.motoristaId })
      .from(portalMotoristaAcessos)
      .where(eq(portalMotoristaAcessos.ativo, 1))
      .orderBy(asc(portalMotoristaAcessos.motoristaId))
      .limit(Math.max(1, limite)),
  );

  let lidos = 0;
  let falhas = 0;
  let avisos = 0;
  let pulados = 0;
  for (const { motoristaId } of acessiveis) {
    // O ciclo do cron tem 60 s para fila + navios + portal: nunca estoura aqui.
    if (Date.now() - inicio > prazoMs) {
      pulados++;
      continue;
    }
    const [ultima] = await comBanco(() =>
      db
        .select({ em: portalLeituras.criadoEm })
        .from(portalLeituras)
        .where(eq(portalLeituras.motoristaId, motoristaId))
        .orderBy(desc(portalLeituras.id))
        .limit(1),
    );
    if (ultima && Date.now() - new Date(ultima.em).getTime() < INTERVALO_LEITURA_MS) continue;
    try {
      const r = await monitorarMotorista(motoristaId);
      if (!r.rodou) continue;
      if (r.ok) lidos++;
      else falhas++;
      if (r.aviso?.enviado) avisos++;
    } catch (e) {
      falhas++;
      console.error("[portal-copadubo] leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  return { motoristas: acessiveis.length, lidos, falhas, avisos, ...(pulados ? { pulados } : {}) };
}

/** Resumo textual do último status para o administrador (sem segredo). */
export function diagnosticoTexto(leitura: {
  ok: boolean;
  loginRecusado: boolean;
  captcha: boolean;
  totalLinhas: number;
  ms: number;
  titulo: string | null;
  diagnostico: string | null;
}): string {
  if (leitura.loginRecusado) return "Login recusado pelo portal (CPF/senha).";
  if (leitura.captcha) return "Portal pediu captcha — leitura automática bloqueada.";
  if (!leitura.ok) return "Leitura sem conteúdo.";
  return `${leitura.totalLinhas} linha(s) lidas em ${leitura.ms} ms${leitura.titulo ? ` · ${leitura.titulo}` : ""}`;
}

/** Junta dois endereços do portal sem depender de `new URL` no cliente. */
export function urlPortalRelativa(caminho: string): string {
  return resolverUrl(urlPortal(), caminho);
}

/** Remove qualquer segredo de uma mensagem antes de mostrar/gravar. */
export function semCredenciais(texto: string, credenciais: CredenciaisPortal | null): string {
  let t = texto;
  if (credenciais?.senha && credenciais.senha.length >= 4) t = t.split(credenciais.senha).join("••••");
  const cpf = limparCpf(credenciais?.cpf ?? "");
  if (cpf) t = t.split(cpf).join("•••");
  return t.slice(0, 400);
}

/** Campos que NUNCA podem sair do servidor (checados pelo teste). */
export const CHAVES_SENSIVEIS = ["cpf", "senha", "senhaCifrada", "cookies"];

export async function contarFalhasSeguidas(motoristaId: number): Promise<number> {
  if (!temBancoConfigurado) return 0;
  const linhas = await comBanco(() =>
    db
      .select({ ok: portalLeituras.ok })
      .from(portalLeituras)
      .where(and(eq(portalLeituras.motoristaId, motoristaId), ne(portalLeituras.hash, "")))
      .orderBy(desc(portalLeituras.id))
      .limit(10),
  );
  let n = 0;
  for (const l of linhas) {
    if (l.ok === 1) break;
    n++;
  }
  return n;
}

export { hashConteudo, extrairSecoes };
