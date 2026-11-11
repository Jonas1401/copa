import { interpretarStatus, type SecaoPortal } from "./portal-copadubo-parse";

/** Só destaca uma dispensa confirmada recentemente para o próprio número. */
export function pontoEmDispensa(
  leitura: { ok: number; secoes: unknown; criadoEm: Date } | null,
  ponto: { livro: string; numero: number; criadoEm: string },
  agora = Date.now(),
): boolean {
  if (!leitura || leitura.ok !== 1 || !Array.isArray(leitura.secoes)) return false;
  const lidoEm = new Date(leitura.criadoEm).getTime();
  if (!Number.isFinite(lidoEm) || lidoEm > agora || agora - lidoEm > 15 * 60_000 || lidoEm < new Date(ponto.criadoEm).getTime()) return false;
  // Motorista com mais de um ponto: vale o cartão DESTE número, não o primeiro.
  const codigo = `${ponto.livro}${String(ponto.numero).padStart(3, "0")}`;
  const status = interpretarStatus(leitura.secoes as SecaoPortal[], codigo);
  return status?.turno === "EM DISPENSA" && status.codigo === codigo;
}
