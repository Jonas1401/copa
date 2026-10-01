/**
 * Token curto de wake-up para o Service Worker manter o /api/cron rodando
 * quando o app está fechado. Ver comentários em src/app/api/cron/wake/route.ts.
 */
import crypto from "node:crypto";
import { db } from "@/db";
import { configuracao } from "@/db/schema";
import { eq } from "drizzle-orm";

const CHAVE = "wake_token";
const ROTACAO_MS = 12 * 60 * 60 * 1000;

type WakeToken = { token: string; geradoEm: number };

export async function obterOuCriarWakeToken(): Promise<string | null> {
  try {
    const [linha] = await db
      .select()
      .from(configuracao)
      .where(eq(configuracao.chave, CHAVE))
      .limit(1);
    let parsed: WakeToken | null = null;
    if (linha?.valor) {
      try { parsed = JSON.parse(linha.valor) as WakeToken; } catch { parsed = null; }
    }
    if (!parsed || Date.now() - parsed.geradoEm > ROTACAO_MS) {
      const novo: WakeToken = {
        token: crypto.randomBytes(18).toString("base64url"),
        geradoEm: Date.now(),
      };
      await db
        .insert(configuracao)
        .values({ chave: CHAVE, valor: JSON.stringify(novo) })
        .onConflictDoUpdate({ target: configuracao.chave, set: { valor: JSON.stringify(novo) } });
      parsed = novo;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export async function validarWakeToken(t: string | null): Promise<boolean> {
  if (!t) return false;
  try {
    const [linha] = await db
      .select()
      .from(configuracao)
      .where(eq(configuracao.chave, CHAVE))
      .limit(1);
    if (!linha?.valor) return false;
    const parsed = JSON.parse(linha.valor) as WakeToken | null;
    return Boolean(parsed?.token && parsed.token === t);
  } catch {
    return false;
  }
}
