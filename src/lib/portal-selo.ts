/**
 * SELO DO PONTO NA TELA — o que o Status do Portal do Motorista muda no selo
 * do ponto (ATIVO, NA VEZ, ESCALADO, DISPENSA…).
 *
 * Arquivo sem dependências: é usado pela tela (no aparelho) e pelos testes.
 */

export type CorSelo = "vermelho" | "verde" | "ambar";

export type SeloPortal = { texto: string; cor: CorSelo };

/** O que a tela precisa saber do ponto para montar o selo. */
export type PontoDoSelo = {
  /** Situação no QUADRO: AGUARDANDO, NA VEZ ou SAIU. */
  status: string;
  emDispensa?: boolean;
  /** Situação lida há pouco no Status do portal (vazio = sem leitura recente). */
  situacaoPortal?: string | null;
};

/**
 * Selo que a situação lida no portal impõe ao ponto — ou `null` quando vale o
 * que o quadro mostra (a posição na fila, NA VEZ, SAIU).
 *
 *   EM DISPENSA                         → DISPENSA (vermelho)
 *   ESCALADO / EM ATENDIMENTO           → o texto do portal (âmbar), mesmo que o
 *                                         número ainda apareça no quadro
 *   ATIVO com o número FORA do quadro   → ATIVO (verde): quem manda é o portal
 *   ATIVO com o número no quadro        → null: o quadro mostra a posição
 */
export function seloDoPortal(p: PontoDoSelo): SeloPortal | null {
  if (p.emDispensa) return { texto: "DISPENSA", cor: "vermelho" };
  const situacao = (p.situacaoPortal ?? "").trim().toUpperCase();
  if (!situacao) return null;
  if (situacao === "EM DISPENSA") return { texto: "DISPENSA", cor: "vermelho" };
  if (situacao === "ESCALADO" || situacao === "EM ATENDIMENTO") return { texto: situacao, cor: "ambar" };
  if (p.status !== "SAIU") return null;
  return { texto: situacao, cor: situacao === "ATIVO" || situacao === "AGUARDANDO" ? "verde" : "ambar" };
}

/** O portal diz que o ponto está fora da fila (trabalhando ou em dispensa). */
export function foraDaFilaPeloPortal(p: PontoDoSelo): boolean {
  const selo = seloDoPortal(p);
  return Boolean(selo) && selo?.cor !== "verde";
}

export type AvisoSaida = "portal" | "sem_acesso" | "pausado" | "quadro";

/**
 * Chamada para cadastrar o acesso ao portal, quando é ele que avisa a saída e
 * o motorista está sem acesso (nunca cadastrou, ou a senha foi recusada).
 * `null` = nada a pedir.
 */
export function chamadaDoAvisoDeSaida(aviso: AvisoSaida | null | undefined): { titulo: string; texto: string } | null {
  if (aviso === "sem_acesso") {
    return {
      titulo: "Aviso de saída desligado",
      texto:
        "Quem avisa que o seu ponto saiu para o trabalho é o Status do Portal do Motorista. Toque aqui e cadastre o CPF e a senha do portal.",
    };
  }
  if (aviso === "pausado") {
    return {
      titulo: "Aviso de saída parado",
      texto: "O portal recusou a sua senha, então a leitura do Status parou. Toque aqui e cadastre o CPF e a senha de novo.",
    };
  }
  return null;
}
