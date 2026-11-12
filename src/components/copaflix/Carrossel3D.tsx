"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { Titulo } from "@/lib/copaflix/tipos";
import { ConteudoDaCapa } from "./Cartaz";

/**
 * Roda 3D de capas do CopaFlix.
 *
 * É um carrossel de verdade, não uma imagem: o usuário arrasta (dedo, mouse ou
 * caneta), a roda gira em perspectiva, a capa do centro fica em evidência e a
 * próxima ocupa o lugar dela. Também aceita teclado (setas/Home/End), clique
 * numa capa lateral para trazê-la ao centro e clique na capa central para abrir.
 *
 * Comprar atenção: `touch-action: pan-y` deixa a página rolar na vertical; o
 * arrasto horizontal é capturado pelo carrossel. Com "reduzir movimento" no
 * sistema, a roda ainda funciona, só sem a animação longa.
 */

const PERSPECTIVA = 1200;

function useLarguraDoPalco() {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth);
    medir();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", medir);
      return () => window.removeEventListener("resize", medir);
    }
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  return { ref, largura };
}

export default function Carrossel3D({
  itens,
  indice,
  onIndice,
  onAbrir,
  rotulo = "Destaques do CopaFlix",
}: {
  itens: Titulo[];
  indice: number;
  onIndice: (indice: number) => void;
  onAbrir: (titulo: Titulo) => void;
  rotulo?: string;
}) {
  const reduzir = Boolean(useReducedMotion());
  const { ref: palcoRef, largura: larguraDisponivel } = useLarguraDoPalco();
  const [arrastoGraus, setArrastoGraus] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const gesto = useRef({
    ativo: false,
    inicioX: 0,
    ultimoX: 0,
    ultimoTempo: 0,
    velocidade: 0,
    moveu: 0,
    capturado: false,
  });

  const total = itens.length;
  const indiceSeguro = total ? Math.min(Math.max(indice, 0), total - 1) : 0;
  const passo = total ? 360 / Math.max(total, 3) : 0;

  // Tamanho da capa conforme a tela (celular/tablet/computador).
  const largura = useMemo(() => {
    if (!larguraDisponivel) return 200;
    const fator = larguraDisponivel >= 1024 ? 0.3 : larguraDisponivel >= 640 ? 0.4 : 0.62;
    return Math.round(Math.max(148, Math.min(larguraDisponivel * fator, 360)));
  }, [larguraDisponivel]);

  const altura = Math.round(largura * 0.6);
  const raio = useMemo(() => {
    if (total < 2) return 0;
    const angulo = Math.PI / Math.max(total, 3);
    // Raio da roda: a distância (corda) entre duas capas vizinhas precisa ser
    // MAIOR que a largura da capa — sem isso as capas se sobrepõem no centro.
    const espaco = largura * 1.12;
    return Math.max(largura * 0.8, espaco / 2 / Math.sin(angulo));
  }, [largura, total]);

  const rotacao = -(indiceSeguro * passo) + arrastoGraus;

  const irPara = useCallback(
    (alvo: number) => {
      if (!total) return;
      const proximo = Math.min(Math.max(alvo, 0), total - 1);
      onIndice(proximo);
    },
    [onIndice, total],
  );

  function soltar() {
    if (!gesto.current.ativo) return;
    const { velocidade, moveu } = gesto.current;
    gesto.current.ativo = false;
    setArrastando(false);

    if (moveu < 6) {
      setArrastoGraus(0);
      return;
    }

    // Inércia curta: a roda continua no sentido do gesto e encaixa na capa
    // mais próxima. `passo` em graus equivale a uma capa.
    // Inércia curta: no máximo meia capa além do que o dedo já andou, para um
    // "tapa" rápido não atravessar a roda inteira. `passo` = uma capa.
    const inercia = Math.max(-passo * 0.5, Math.min(passo * 0.5, velocidade * 120));
    const projetado = arrastoGraus + inercia;
    const passos = Math.round(projetado / passo);
    irPara(indiceSeguro - passos);
    setArrastoGraus(0);
  }

  useEffect(() => {
    if (!arrastando) return;
    const cancelar = () => {
      setArrastando(false);
      setArrastoGraus(0);
      gesto.current.ativo = false;
    };
    window.addEventListener("pointercancel", cancelar);
    return () => window.removeEventListener("pointercancel", cancelar);
  }, [arrastando]);

  function aoPressionar(evento: React.PointerEvent<HTMLDivElement>) {
    if (evento.pointerType === "mouse" && evento.button !== 0) return;
    const alvo = evento.target as HTMLElement;
    if (alvo.closest("[data-controle]")) return;
    gesto.current = {
      ativo: true,
      inicioX: evento.clientX,
      ultimoX: evento.clientX,
      ultimoTempo: performance.now(),
      velocidade: 0,
      moveu: 0,
      capturado: false,
    };
    setArrastando(true);
  }

  function aoMover(evento: React.PointerEvent<HTMLDivElement>) {
    if (!gesto.current.ativo) return;
    const dx = evento.clientX - gesto.current.inicioX;
    gesto.current.moveu = Math.max(gesto.current.moveu, Math.abs(dx));

    // ~90% da largura da capa para virar uma capa inteira. Arrastar para a
    // esquerda traz a PRÓXIMA capa (a roda anda no sentido do dedo).
    const sensibilidade = Math.max(90, largura * 0.9);
    let graus = (dx / sensibilidade) * passo;
    // Nas pontas, resistência elástica (a roda não "fura" o fim da lista).
    const base = -indiceSeguro * passo;
    const limite = (total - 1) * passo;
    const destino = base + graus;
    if (destino > 0) graus = -base + destino * 0.25;
    else if (destino < -limite) graus = -base - limite + (destino + limite) * 0.25;

    // Só captura o ponteiro depois do limiar: assim um toque simples continua
    // chegando ao botão da capa (e abre a ficha), sem virar arrasto.
    if (!gesto.current.capturado && gesto.current.moveu > 6) {
      gesto.current.capturado = true;
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
    }

    const agora = performance.now();
    const dt = Math.max(1, agora - gesto.current.ultimoTempo);
    const delta = graus - arrastoGraus;
    // Graus por milissegundo, com teto — sensação estável em mouse e toque.
    gesto.current.velocidade = Math.max(-0.8, Math.min(0.8, delta / dt));
    gesto.current.ultimoTempo = agora;
    gesto.current.ultimoX = evento.clientX;

    setArrastoGraus(graus);
  }

  function aoClicar(titulo: Titulo, posicao: number) {
    if (gesto.current.moveu > 8) return;
    if (posicao === indiceSeguro) onAbrir(titulo);
    else irPara(posicao);
  }

  if (!total) return null;

  return (
    <section
      aria-label={rotulo}
      aria-roledescription="carrossel"
      className="relative"
    >
      <div
        ref={palcoRef}
        className="cf-roda"
        tabIndex={0}
        role="group"
        aria-label={`${rotulo} — use as setas do teclado ou arraste`}
        data-arrastando={arrastando ? "true" : "false"}
        style={{ height: altura + 56, touchAction: "pan-y" }}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={soltar}
        onPointerCancel={() => {
          gesto.current.ativo = false;
          setArrastando(false);
          setArrastoGraus(0);
        }}
        onPointerLeave={(evento) => {
          if (gesto.current.ativo) soltar();
          else if (evento.pointerType !== "mouse") soltar();
        }}
        onKeyDown={(evento) => {
          if (evento.key === "ArrowRight") {
            evento.preventDefault();
            irPara(indiceSeguro + 1);
          } else if (evento.key === "ArrowLeft") {
            evento.preventDefault();
            irPara(indiceSeguro - 1);
          } else if (evento.key === "Home") {
            evento.preventDefault();
            irPara(0);
          } else if (evento.key === "End") {
            evento.preventDefault();
            irPara(total - 1);
          } else if (evento.key === "Enter" || evento.key === " ") {
            const titulo = itens[indiceSeguro];
            if (titulo) {
              evento.preventDefault();
              onAbrir(titulo);
            }
          }
        }}
        onWheel={(evento) => {
          if (Math.abs(evento.deltaX) < Math.abs(evento.deltaY) || Math.abs(evento.deltaX) < 8) return;
          const agora = Date.now();
          const anterior = Number((evento.currentTarget as HTMLElement).dataset.ultimaRoda ?? 0);
          if (agora - anterior < 260) return;
          (evento.currentTarget as HTMLElement).dataset.ultimaRoda = String(agora);
          irPara(indiceSeguro + (evento.deltaX > 0 ? 1 : -1));
        }}
      >
        <div
          className="cf-roda-palco"
          style={{
            width: largura,
            height: altura,
            transform: `translateZ(${-raio}px) rotateY(${rotacao}deg)`,
            transition: arrastando || reduzir ? "none" : "transform 520ms cubic-bezier(0.22, 0.85, 0.28, 1)",
          }}
        >
          {itens.map((titulo, posicao) => {
            const anguloRelativo = ((posicao * passo + rotacao) % 360 + 540) % 360 - 180;
            const distancia = Math.abs(anguloRelativo);
            const visivel = distancia < 96;
            const focado = posicao === indiceSeguro;
            return (
              <div
                key={titulo.id}
                className="cf-roda-item"
                data-focada={focado ? "true" : "false"}
                aria-hidden={!visivel}
                style={{
                  width: largura,
                  height: altura,
                  transform: `rotateY(${posicao * passo}deg) translateZ(${raio}px)`,
                  opacity: visivel ? (focado ? 1 : 0.55) : 0,
                  pointerEvents: visivel ? "auto" : "none",
                  zIndex: focado ? 30 : Math.max(1, 20 - Math.round(distancia / 8)),
                }}
              >
                <span className="cf-capa-brilho" aria-hidden />
                <button
                  type="button"
                  tabIndex={focado ? 0 : -1}
                  aria-label={`${titulo.titulo}${focado ? " — abrir" : " — trazer para o centro"}`}
                  aria-current={focado ? "true" : undefined}
                  onClick={() => aoClicar(titulo, posicao)}
                  className="cf-capa block h-full w-full cursor-pointer text-left"
                >
                  <span className="cf-capa-moldura block h-full w-full">
                    <ConteudoDaCapa titulo={titulo} prioridade={focado} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="-mt-1 flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Escolher destaque">
          {itens.map((titulo, posicao) => (
            <button
              key={titulo.id}
              type="button"
              role="tab"
              aria-selected={posicao === indiceSeguro}
              aria-label={titulo.titulo}
              data-controle="true"
              onClick={() => irPara(posicao)}
              className={`h-1.5 rounded-full transition-all ${
                posicao === indiceSeguro ? "w-6 bg-ciano" : "w-1.5 bg-gelo/25 hover:bg-gelo/50"
              }`}
            />
          ))}
        </div>
        <p className="cf-roda-dica flex items-center gap-1.5">
          <span aria-hidden>‹</span> arraste para girar <span aria-hidden>›</span>
        </p>
      </div>
    </section>
  );
}
