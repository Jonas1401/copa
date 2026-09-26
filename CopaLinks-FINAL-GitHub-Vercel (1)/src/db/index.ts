import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

// Aceita DATABASE_URL padrão ou POSTGRES_URL injetada pelo Vercel Postgres/Neon
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!databaseUrl) {
  // Sem banco configurado o BUILD precisa passar: o pool é criado com um
  // endereço inofensivo e qualquer consulta falha em runtime — a home detecta
  // isso e mostra a tela "conecte o banco". No sandbox/local, DATABASE_URL
  // sempre existe e tudo funciona normalmente.
  console.warn("[db] DATABASE_URL não configurada — consultas vão falhar em runtime.");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// Em servidores remotos (Vercel, Neon, Supabase), habilita SSL automaticamente
const isLocal =
  !databaseUrl ||
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1") ||
  databaseUrl.includes("host.docker.internal");

// Supabase em modo pooler (pgbouncer, porta 6543) não suporta prepared
// statements; desligamos nesses casos para o node-postgres funcionar.
const usaPooler = Boolean(
  databaseUrl && (/pooler\.supabase\.|pgbouncer|:6543\//.test(databaseUrl)),
);

// Supabase apresenta cadeia com certificado próprio no proxy; validação estrita
// falha com "self-signed certificate in certificate chain", então confiamos no
// servidor (padrão recomendado pelo Supabase para conexões SSL).
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl || "postgresql://banco-nao-configurado@localhost:5432/placeholder",
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    prepared: !usaPooler,
    max: usaPooler ? 1 : 10,
    idleTimeoutMillis: 30000,
  } as PoolConfig);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
