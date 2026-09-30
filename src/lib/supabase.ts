/**
 * O Supabase do CopaLinks é PostgreSQL. Toda consulta do Monitor WhatsApp
 * continua usando a conexão Drizzle já existente (DATABASE_URL, só servidor).
 * Não usa chaves REST service-role nem SDK Supabase no navegador.
 */
export { db } from "@/db";
