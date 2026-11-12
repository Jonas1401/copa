"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  alternarFavorito,
  armazenamentoDoAparelho,
  avisarMudanca,
  continuaAssistindo,
  EVENTO_ALTERADO,
  lerFavoritos,
  lerHistorico,
  lerProgresso,
  limparHistorico as limparHistoricoDoAparelho,
  registrarHistorico,
  removerProgresso,
  salvarProgresso,
  type Favorito,
  type ItemHistorico,
  type Progresso,
} from "@/lib/copaflix/armazenamento";
import type { Titulo } from "@/lib/copaflix/tipos";

/**
 * Estado local do CopaFlix (favoritos, histórico e progresso) compartilhado
 * entre as telas do módulo. Tudo no aparelho — ver src/lib/copaflix/armazenamento.ts.
 */
export function useCopaFlixLocal() {
  const armazem = useMemo(() => armazenamentoDoAparelho(), []);
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [progresso, setProgresso] = useState<Progresso[]>([]);
  const [historico, setHistorico] = useState<ItemHistorico[]>([]);

  const sincronizar = useCallback(() => {
    setFavoritos(lerFavoritos(armazem));
    setProgresso(lerProgresso(armazem));
    setHistorico(lerHistorico(armazem));
  }, [armazem]);

  useEffect(() => {
    const aoMudar = () => sincronizar();
    // A primeira leitura sai do ciclo síncrono do efeito: o HTML do servidor
    // (sem localStorage) hidrata igual ao primeiro render do cliente, e só
    // depois os dados do aparelho aparecem. Sem render em cascata.
    const timer = setTimeout(sincronizar, 0);
    window.addEventListener(EVENTO_ALTERADO, aoMudar);
    window.addEventListener("storage", aoMudar);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(EVENTO_ALTERADO, aoMudar);
      window.removeEventListener("storage", aoMudar);
    };
  }, [sincronizar]);

  const ehFavorito = useCallback(
    (id: string) => favoritos.some((f) => f.id === id),
    [favoritos],
  );

  const alternar = useCallback(
    (titulo: Titulo) => {
      alternarFavorito(armazem, {
        id: titulo.id,
        titulo: titulo.titulo,
        tipo: titulo.tipo,
        capa: titulo.capa,
        arte: titulo.arte,
      });
      avisarMudanca();
      sincronizar();
    },
    [armazem, sincronizar],
  );

  const salvar = useCallback(
    (
      titulo: Titulo,
      dados: {
        posicao: number;
        duracao: number;
        episodioId?: string;
        episodioTitulo?: string;
        temporada?: number;
        numero?: number;
      },
    ) => {
      salvarProgresso(armazem, {
        id: titulo.id,
        titulo: titulo.titulo,
        tipo: titulo.tipo,
        capa: titulo.capa,
        arte: titulo.arte,
        ...dados,
      });
      avisarMudanca();
    },
    [armazem],
  );

  const registrarAbertura = useCallback(
    (titulo: Titulo) => {
      registrarHistorico(armazem, { id: titulo.id, titulo: titulo.titulo, tipo: titulo.tipo });
      avisarMudanca();
    },
    [armazem],
  );

  const limparHistorico = useCallback(() => {
    limparHistoricoDoAparelho(armazem);
    avisarMudanca();
    sincronizar();
  }, [armazem, sincronizar]);

  const esquecer = useCallback(
    (id: string) => {
      removerProgresso(armazem, id);
      avisarMudanca();
      sincronizar();
    },
    [armazem, sincronizar],
  );

  // Derivado do ESTADO (não do localStorage direto): assim o primeiro render
  // do cliente é igual ao do servidor e a hidratação não quebra.
  const continuar = useMemo(() => progresso.filter(continuaAssistindo), [progresso]);

  const progressoDe = useCallback(
    (id: string, episodioId?: string) => {
      const entrada = progresso.find((p) => p.id === id);
      if (!entrada) return null;
      if (episodioId && entrada.episodioId && entrada.episodioId !== episodioId) return null;
      return entrada;
    },
    [progresso],
  );

  return {
    favoritos,
    progresso,
    historico,
    continuar,
    ehFavorito,
    alternarFavorito: alternar,
    salvarProgresso: salvar,
    registrarAbertura,
    limparHistorico,
    esquecer,
    progressoDe,
  };
}
