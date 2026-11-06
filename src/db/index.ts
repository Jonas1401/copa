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
    max: usaPooler ? 3 : 5,
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
      return connectOriginal(...args);
    }) as Pool["connect"];
  }

  return instancia;
}

const urlAtual = databaseUrl ?? "";
if (!globalForDb.__arenaNextJsPostgresqlPool || globalForDb.__arenaNextJsPostgresqlUrl !== urlAtual) {
  globalForDb.__arenaNextJsPostgresqlPool = criarPool();
  globalForDb.__arenaNextJsPostgresqlUrl = urlAtual;
}

export const pool = globalForDb.__arenaNextJsPostgresqlPool;

export const db = drizzle(pool);
