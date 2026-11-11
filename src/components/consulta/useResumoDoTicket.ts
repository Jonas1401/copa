"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CABECALHO_DA_TELA, VERSAO_DA_TELA, type ResumoDoTicket } from "@/lib/ticket-card";

/** O que a última consulta deixou — e de qual motorista ela é. */
type Guardado = { dono: number | null; resumo: ResumoDoTicket | null; naoLogado: boolean; carregado: boolean };

/**
 * O resumo do “Saldo de Ganhos” do motorista logado (viagens, bruto e
 * comissão da semana, somando todos os pontos dele), como o servidor guardou. O GET não fala com o portal:
 * só devolve a última leitura — por isso pode ser repetido a cada minuto
 * enquanto a tela está visível. Quem não ligou a consulta (não cadastrou a
 * porcentagem) não repete: só pergunta ao abrir e ao voltar para a tela.
 *
 * `naoLogado`: o servidor respondeu 401 (não há cadastro neste aparelho).
 *
 * `dono`: o motorista deste aparelho, para a tela que continua aberta quando
 * ele muda (a inicial). O que foi lido para um motorista nunca aparece para
 * outro: trocou o dono, a tela volta a “carregando” e consulta de novo.
 */
export function useResumoDoTicket(ativo: boolean, intervaloMs = 60_000, dono: number | null = null) {
  const [guardado, setGuardado] = useState<Guardado>({ dono: null, resumo: null, naoLogado: false, carregado: false });
  // A hora usada nas contas de “leitura antiga”: anda junto com cada consulta.
  const [agora, setAgora] = useState(0);
  // Sem cadastro neste aparelho, ou com a consulta desligada, não há o que
  // repetir de minuto em minuto: só ao abrir e ao voltar à tela.
  const semRepeticao = useRef(false);
  const donoAtual = useRef(dono);
  useEffect(() => {
    donoAtual.current = dono;
  }, [dono]);

  const carregar = useCallback(async () => {
    const de = donoAtual.current;
    // O motorista mudou enquanto a resposta vinha: ela é de outro, não entra.
    const outro = () => donoAtual.current !== de;
    const guardar = (novo: Partial<Guardado>) => setGuardado((g) => ({ ...(g.dono === de ? g : { resumo: null, naoLogado: false }), dono: de, carregado: true, ...novo }));
    try {
      const r = await fetch("/api/tickets", { cache: "no-store", headers: { [CABECALHO_DA_TELA]: VERSAO_DA_TELA } });
      if (outro()) return;
      setAgora(Date.now());
      semRepeticao.current = r.status === 401;
      if (r.status === 401) {
        guardar({ naoLogado: true, resumo: null });
        return;
      }
      if (!r.ok) {
        guardar({});
        return;
      }
      const dados = (await r.json().catch(() => null)) as ResumoDoTicket | null;
      if (outro()) return;
      if (dados && typeof dados === "object" && "ligado" in dados) {
        semRepeticao.current = !dados.ligado;
        guardar({ naoLogado: false, resumo: dados });
      } else {
        guardar({});
      }
    } catch {
      /* Sem rede: fica o que já estava na tela; a próxima volta tenta de novo. */
      if (!outro()) guardar({});
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
    // `dono` entra aqui de propósito: motorista novo, consulta nova na hora.
  }, [ativo, carregar, intervaloMs, dono]);

  /** Troca o resumo pelo que uma ação (salvar, atualizar, desligar) devolveu. */
  const receber = useCallback((novo: ResumoDoTicket) => {
    semRepeticao.current = !novo.ligado;
    setAgora(Date.now());
    setGuardado({ dono: donoAtual.current, resumo: novo, naoLogado: false, carregado: true });
  }, []);

  // Só vale o que foi lido para o motorista que está na tela agora.
  const meu = ativo && guardado.dono === dono;
  return {
    resumo: meu ? guardado.resumo : null,
    naoLogado: meu && guardado.naoLogado,
    carregado: meu && guardado.carregado,
    agora,
    carregar,
    receber,
  };
}
