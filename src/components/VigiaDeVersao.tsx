"use client";

import { useEffect } from "react";
import { ligarVigiaDeVersao } from "@/lib/atualizacao-da-tela";
import { VERSAO_DO_APP } from "@/lib/versao-app";

/**
 * VIGIA DE VERSÃO — está em todas as páginas (layout raiz) e não desenha nada.
 *
 * O celular guarda a página aberta por horas, às vezes dias: quem não fecha o
 * app continua com o código (e os textos) da publicação antiga. O vigia
 * pergunta ao servidor qual é a versão no ar — quando a pessoa volta para o
 * app e, com a tela à vista, a cada 5 minutos — e, quando é outra, recarrega a
 * página num momento em que não atrapalha: logo que a pessoa volta (antes de
 * tocar em qualquer coisa) ou com a tela parada há 5 minutos.
 *
 * Nunca recarrega em segundo plano, nem se algo foi digitado ou escolhido na
 * página, nem com uma janela aberta por cima (a conversa, um alerta), nem nas
 * telas do administrador, nem em laço. As regras e a ligação com o navegador
 * estão em `@/lib/atualizacao-da-tela` (`podeRecarregar`, `ligarVigiaDeVersao`).
 */
export default function VigiaDeVersao() {
  useEffect(
    () =>
      ligarVigiaDeVersao({
        versao: VERSAO_DO_APP,
        documento: document,
        janela: window,
        buscar: (endereco, opcoes) => fetch(endereco, opcoes),
        armazenamento: () => window.sessionStorage,
        caminho: () => window.location.pathname,
        recarregar: () => window.location.reload(),
      }),
    [],
  );
  return null;
}
