import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";

// Aceita DATABASE_URL padrão ou POSTGRES_URL injetada pelo Vercel Postgres/Neon
const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  process.env.POSTGRES_PRISMA_URL?.trim();

export const temBancoConfigurado = Boolean(databaseUrl);

if (!temBancoConfigurado) {
  // Sem banco configurado o BUILD precisa passar: o pool é criado com um
  // endereço inofensivo e qualquer consulta falha em runtime — a home detecta
  // isso e mostra a tela "conecte o banco". No sandbox/local, DATABASE_URL
  // sempre existe e tudo funciona normalmente.
  console.warn("[db] DATABASE_URL não configurada — consultas vão falhar em runtime.");
}

/** Tempo máximo que uma conexão pode ficar parada antes de ser descartada. */
export const IDLE_TIMEOUT_MS = 5_000;
/** Prazo para obter uma conexão do pool (abaixo do limite de 10 s da Vercel Hobby). */
export const CONNECTION_TIMEOUT_MS = 3_500;
/** Prazo de leitura de cada consulta: impede socket congelado de travar o pool. */
export const QUERY_TIMEOUT_MS = 6_000;

/**
 * Quantas vezes uma conexão que nem chegou a ser aberta é tentada de novo.
 *
 * O pooler do Supabase (Supavisor) recusa conexões por alguns instantes em
 * situações do próprio provedor: `PAM authentication failed for user "postgres"`
 * (28P01/28000) e `Authentication credentials are invalid. Please reconnect
 * with fresh credentials to restore pool functionality.` (o tenant fica em
 * `waiting_for_secrets` depois de um restart). Nos dois casos a senha está
 * certa e a conexão seguinte costuma autenticar — o erro só chega cedo, antes
 * de qualquer consulta rodar. Sem esta nova tentativa, cada oscilação dessas
 * derrubava a rota (500 sem corpo) e o app caía para OFFLINE.
 */
export const TENTATIVAS_CONEXAO = 4;
/**
 * Espera entre as tentativas (cresce a cada rodada; base do backoff + jitter).
 * A soma fica em torno de 2 s: suficiente para atravessar o pisca-pisca do
 * pooler e curto o bastante para não estourar o limite de 10 s da função.
 */
export const ESPERA_ENTRE_TENTATIVAS_MS = 300;
/**
 * Teto de tempo das novas tentativas. A função serverless da Vercel Hobby tem
 * 10 s: nunca vale a pena gastar mais que isto para abrir uma conexão — é
 * melhor devolver o erro e a próxima batida do app (5 s) tentar de novo.
 */
export const PRAZO_RETENTATIVA_MS = 7_000;

/** Códigos/mensagens de falha que acontecem ANTES de a consulta ser enviada. */
const CODIGOS_TRANSITORIOS = new Set([
  "28P01", // invalid_password (senha/pooler)
  "28000", // invalid_authorization_specification (PAM do Supabase)
  "53300", // too many connections
  "57P03", // cannot_connect_now (banco acordando)
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

const MENSAGENS_TRANSITORIAS = [
  "timeout exceeded when trying to connect",
  "connection terminated",
  "connection timeout",
  "authentication credentials are invalid",
  "pam authentication failed",
  "password authentication failed",
  "server closed the connection unexpectedly",
  "cannot connect now",
  "too many connections",
  "getaddrinfo",
];

/**
 * Falha de conexão/autenticação: a consulta não chegou ao banco, então repetir
 * é seguro (nada foi gravado) e é o que salva o app nas oscilações do pooler.
 */
export function erroTransitorioDeConexao(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; message?: unknown; cause?: unknown };
  const codigo = typeof e.code === "string" ? e.code.toUpperCase() : "";
  if (CODIGOS_TRANSITORIOS.has(codigo)) return true;
  if (e.cause && e.cause !== erro && erroTransitorioDeConexao(e.cause)) return true;
  const texto = (typeof e.message === "string" ? e.message : String(erro)).toLowerCase();
  return MENSAGENS_TRANSITORIAS.some((m) => texto.includes(m));
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Backoff com jitter: evita que várias funções acordem e batam juntas. */
function esperaDaTentativa(tentativa: number): number {
  const base = ESPERA_ENTRE_TENTATIVAS_MS * tentativa * tentativa;
  return base + Math.floor(Math.random() * ESPERA_ENTRE_TENTATIVAS_MS);
}

type ClienteRastreado = PoolClient & {
  __idleSince?: number;
  connection?: {
    stream?: {
      destroyed?: boolean;
      writableEnded?: boolean;
      destroy?: () => void;
    };
  };
};

type ItemOciosoInterno = {
  client: ClienteRastreado;
  timeoutId?: ReturnType<typeof setTimeout>;
};

type PoolInterno = Pool & {
  _idle?: ItemOciosoInterno[];
  _remove?: (client: ClienteRastreado) => void;
  __copalinksProtegido?: boolean;
};

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlUrl?: string;
};

// Em servidores remotos (Vercel, Neon, Supabase), habilita SSL automaticamente
const isLocal =
  !databaseUrl ||
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1") ||
  databaseUrl.includes("host.docker.internal");

// Supabase em modo pooler (pgbouncer/Supavisor) ou porta 6543: mantém pool enxuto,
// mas com folga (> 1) para não travar requisições simultâneas no mesmo processo.
const usaPooler = Boolean(
  databaseUrl && (/pooler\.supabase\.|pgbouncer|:6543\//.test(databaseUrl)),
);

function destruirSocket(client: ClienteRastreado | undefined) {
  try {
    client?.connection?.stream?.destroy?.();
  } catch {
    // stream já encerrado
  }
}

/**
 * Em ambientes serverless (Vercel), o processo fica congelado entre chamadas.
 * Quando acorda num novo request HTTP, a fase de I/O do Node roda ANTES dos
 * timers expirados: sem esta limpeza síncrona, o pg-pool entrega uma conexão
 * já morta pelo firewall/pooler remoto e a consulta trava até estourar 504.
 */
export function descartarConexoesOciosasVencidas(instancia: Pool, agora = Date.now()) {
  try {
    const interno = instancia as PoolInterno;
    if (!Array.isArray(interno._idle) || typeof interno._remove !== "function") return 0;
    let removidas = 0;
    for (const item of [...interno._idle]) {
      const c = item?.client;
      if (!c) continue;
      const stream = c.connection?.stream;
      const streamMorto = Boolean(stream && (stream.destroyed || stream.writableEnded));
      const venceu = typeof c.__idleSince === "number" && agora - c.__idleSince >= IDLE_TIMEOUT_MS;
      if (streamMorto || venceu) {
        destruirSocket(c);
        interno._remove(c);
        removidas += 1;
      }
    }
    return removidas;
  } catch {
    return 0;
  }
}

function criarPool(): Pool {
  const instancia = new Pool({
    connectionString: databaseUrl || "postgresql://banco-nao-configurado@localhost:5432/placeholder",
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    // Com pooler, cada vaga precisa de folga para a nova tentativa de conexão
    // acontecer sem esperar (o app aberto faz várias consultas ao mesmo tempo).
    max: usaPooler ? 4 : 5,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: 45,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  } as PoolConfig) as PoolInterno;

  instancia.on("error", (err) => {
    console.error("[db] erro em conexão ociosa do pool:", err.message);
  });

  instancia.on("acquire", (client: ClienteRastreado) => {
    delete client.__idleSince;
  });

  instancia.on("release", (err: Error | undefined, client: ClienteRastreado) => {
    if (err) {
      // Fecha imediatamente o socket quebrado/expirado para liberar a vaga no pool.
      destruirSocket(client);
      return;
    }
    client.__idleSince = Date.now();
  });

  if (!instancia.__copalinksProtegido) {
    instancia.__copalinksProtegido = true;
    const connectOriginal = instancia.connect.bind(instancia);
    instancia.connect = ((...args: Parameters<Pool["connect"]>) => {
      descartarConexoesOciosasVencidas(instancia);
      const ultimo = args[args.length - 1];
      if (typeof ultimo === "function") {
        const callback = ultimo as (
          erro: Error | undefined,
          cliente?: PoolClient,
          liberar?: () => void,
        ) => void;
        conectarComNovaTentativa(instancia, connectOriginal).then(
          (cliente) => callback(undefined, cliente, () => cliente.release()),
          (erro: unknown) => callback(erro instanceof Error ? erro : new Error(String(erro))),
        );
        return undefined as unknown as Promise<PoolClient>;
      }
      return conectarComNovaTentativa(instancia, connectOriginal) as unknown as ReturnType<
        Pool["connect"]
      >;
    }) as Pool["connect"];
  }

  return instancia;
}

/**
 * Abre uma conexão repetindo SÓ quando a falha aconteceu antes da consulta
 * sair (o pooler recusou/derrubou o handshake). Assim nenhuma escrita roda
 * duas vezes. Cada nova tentativa recebe uma vaga nova no pool: o cliente que
 * falhou já foi descartado pelo pg-pool.
 */
async function conectarComNovaTentativa(
  instancia: PoolInterno,
  connectOriginal: Pool["connect"],
): Promise<PoolClient> {
  const inicio = Date.now();
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS_CONEXAO; tentativa += 1) {
    try {
      return (await connectOriginal()) as PoolClient;
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa >= TENTATIVAS_CONEXAO || !erroTransitorioDeConexao(erro)) break;
      const espera = esperaDaTentativa(tentativa);
      if (Date.now() - inicio + espera >= PRAZO_RETENTATIVA_MS) break;
      // Descarta o que sobrou de conexão ruim antes de tentar de novo.
      descartarConexoesOciosasVencidas(instancia);
      await esperar(espera);
    }
  }
  throw ultimoErro;
}

const urlAtual = databaseUrl ?? "";
if (!globalForDb.__arenaNextJsPostgresqlPool || globalForDb.__arenaNextJsPostgresqlUrl !== urlAtual) {
  globalForDb.__arenaNextJsPostgresqlPool = criarPool();
  globalForDb.__arenaNextJsPostgresqlUrl = urlAtual;
}

export const pool = globalForDb.__arenaNextJsPostgresqlPool;

export const db = drizzle(pool);

/**
 * Consulta do Drizzle com nova tentativa em falha de conexão.
 *
 * O `db` (drizzle) usa `pool.query`, que obtém a conexão por dentro — o caminho
 * onde o pooler do Supabase recusa o handshake. Este helper repete a MESMA
 * leitura quando a falha é só de conexão/autenticação, sem risco de duplicar
 * escrita (se a consulta não chegou ao banco, nada foi gravado).
 */
export async function comBanco<T>(
  tarefa: () => Promise<T>,
  tentativas = TENTATIVAS_CONEXAO,
): Promise<T> {
  const inicio = Date.now();
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await tarefa();
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa >= tentativas || !erroTransitorioDeConexao(erro)) break;
      const espera = esperaDaTentativa(tentativa);
      if (Date.now() - inicio + espera >= PRAZO_RETENTATIVA_MS) break;
      // Uma conexão que acabou de ser recusada pode estar presa no pool: limpa
      // as ociosas e deixa a próxima tentativa abrir um socket novo.
      descartarConexoesOciosasVencidas(pool);
      await esperar(espera);
    }
  }
  throw ultimoErro;
}
