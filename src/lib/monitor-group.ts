import { createHash } from "node:crypto";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";

export { NOME_GRUPO_MONITORADO };

/**
 * Identificador do único grupo autorizado. Um prefixo semelhante NÃO vale.
 * O Android envia somente este SHA-256, nunca título ou remetente.
 */

export function normalizarNomeGrupo(nome: string) {
  return nome.trim().replace(/\s+/g, " ").toUpperCase();
}

export const HASH_GRUPO_MONITORADO = createHash("sha256")
  .update(normalizarNomeGrupo(NOME_GRUPO_MONITORADO), "utf8")
  .digest("hex");
