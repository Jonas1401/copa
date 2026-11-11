"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CABECALHO_DA_TELA, VERSAO_DA_TELA, type ResumoDoTicket } from "@/lib/ticket-card";

/**
 * O resumo do “Saldo de Ganhos” do motorista logado (viagens, bruto e
 * comissão da semana, somando todos os pontos dele), como o servidor guardou. O GET não fala com o portal:
 * só devolve a última leitura — por isso pode ser repetido a cada minuto
 * enquanto a tela está visível. Quem não ligou a consulta (não cadastrou a
 * porcentagem) não repete: só pergunta ao abrir e ao voltar para a tela.
 *
 * `naoLogado`: o servidor respondeu 401 (não há cadastro neste aparelho).
 */
export function useResumoDoTicket(ativo: boolean, intervaloMs = 60_000) {
  const [resumo, setResumo] = useState<ResumoDoTicket | null>(null);
  const [naoLogado, setNaoLogado] = useState(false);
  const [carregado, setCarregado] = useState(false);
  // A hora usada nas contas de “leitura antiga”: anda junto com cada consulta.
  const [agora, setAgora] = useState(0);
  // Sem cadastro neste aparelho, ou com a consulta desligada, não há o que
  // repetir de minuto em minuto: só ao abrir e ao voltar à tela.
  const semRepeticao = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/tickets", { cache: "no-store", headers: { [CABECALHO_DA_TELA]: VERSAO_DA_TELA } });
      setAgora(Date.now());
      semRepeticao.current = r.status === 401;
      if (r.status === 401) {
        setNaoLogado(true);
        setResumo(null);
        setCarregado(true);
        return;
      }
      if (!r.ok) return;
      const dados = (await r.json().catch(() => null)) as ResumoDoTicket | null;
      if (dados && typeof dados === "object" && "ligado" in dados) {
        semRepeticao.current = !dados.ligado;
        setNaoLogado(false);
        setResumo(dados);
      }
    } catch {
      /* Sem rede: fica o que já estava na tela; a próxima volta tenta de novo. */
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => {
    if (!ativo) return;
    const visivel = () => document.visibilityState === "visible";
    // Diferido: nada de setState síncrono dentro do efeito.
    const primeira = setTimeout(() => void carregar(), 0);
    const ciclo = setInterval(() => {
      if (visivel() && !semRepeticao.current) void carregar();
    }, intervaloMs);
    const aoVoltar = () => {
      if (visivel()) void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearTimeout(primeira);
      clearInterval(ciclo);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ativo, carregar, intervaloMs]);

  /** Troca o resumo pelo que uma ação (salvar, atualizar, desligar) devolveu. */
  const receber = useCallback((novo: ResumoDoTicket) => {
    semRepeticao.current = !novo.ligado;
    setAgora(Date.now());
    setResumo(novo);
  }, []);

  return { resumo: ativo ? resumo : null, naoLogado, carregado, agora, carregar, receber };
}
