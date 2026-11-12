"use client";

import { useEffect, useRef } from "react";
import { ligarAoVoltarParaATela } from "@/lib/atualizacao-da-tela";

/**
 * Chama `acao` quando a tela volta a aparecer: o app saiu do segundo plano, a
 * página voltou do cache de navegação ou a rede voltou.
 *
 * No celular, os temporizadores param com o app em segundo plano. Sem isto, ao
 * voltar, a tela mostra o dado de quando saiu até a próxima volta do ciclo.
 */
export function useAoVoltarParaATela(acao: () => void) {
  const atual = useRef(acao);
  useEffect(() => {
    atual.current = acao;
  });
  useEffect(() => ligarAoVoltarParaATela(document, window, () => atual.current()), []);
}
