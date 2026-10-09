import { sql } from "drizzle-orm";
import { chatMensagens } from "@/db/schema";
import { NOME_NAVIOS_AUTOMACAO } from "@/lib/politica-automacao";

/** Remove do feed e do contador os avisos automáticos antigos que deixaram
 * de ser permitidos. Não apaga mensagens de motoristas nem a memória da IA.
 */
export const chatVisivel = sql`(${chatMensagens.motoristaId} > 0 OR (${chatMensagens.motoristaId} <= 0 AND ${chatMensagens.nome} = ${NOME_NAVIOS_AUTOMACAO}))`;
