"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Anchor,
  ArrowLeft,
  Clock,
  ExternalLink,
  Info,
  RefreshCw,
  Ship,
} from "lucide-react";
import { LOGO } from "@/lib/logo";
import type {
  AtracadoEspelho,
  ManobraEspelho,
  PainelEspelho,
} from "@/lib/espelho-navios";

/**
 * CÓPIA do "COPALINKS — Navios Atracados" (berth-buddy-bot.lovable.app),
 * dentro do próprio CopaLinks. Mesmo conteúdo, mesma ordem e os mesmos
 * rótulos da referência, com o tema Dark Navy do aplicativo: fundo sólido,
 * cartões azul-marinho, ciano nos filtros ativos, verde no progresso de
 * descarga, amarelo para "a confirmar" e azul para "prevista".
 *
 * Funcionalidades: monitoramento das DUAS fontes (APPA + SINPRAPAR),
 * somente navios de fertilizantes, saldos por operadora, percentual de
 * descarga, saldo total, manobras previstas com código/berço/explicação,
 * filtros, atualização automática a cada 30 s, botão de atualizar, links
 * oficiais e aviso explícito quando a leitura ao vivo não está disponível.
 */

type Vista = "atracados" | "manobras";

/**
 * Os acessos aos sites oficiais ficam no rodapé (URLs vêm de `painel.fontes`,
 * a mesma fonte usada no status do monitoramento) — nunca duplicados no topo.
 */

const FILTROS = ["Em manobra", "Aguardando manobra", "Atracado"] as const;
type Filtro = (typeof FILTROS)[number];

function horaPorto(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function TituloGrupo({ children, extra }: { children: ReactNode; extra?: string }) {
  return (
    <div className="mt-7 mb-3 flex items-center gap-3">
      <h2 className="micro shrink-0 font-display text-[12px] font-extrabold text-ciano">{children}</h2>
      {extra && (
        <span className="pill shrink-0 px-2 py-0.5 font-display text-[10px] font-bold text-aco">{extra}</span>
      )}
      <span aria-hidden className="h-px flex-1 bg-borda" />
    </div>
  );
}

function CartaoAtracado({ navio }: { navio: AtracadoEspelho }) {
  const total = navio.operadoras.length;
  return (
    <article className="cartao-monitor rounded-[22px] p-4">
      {/* berço, quantidade de operadoras e navio — na mesma ordem da referência */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="micro text-aco">Berço {navio.berco || "—"}</p>
          <h3 className="mt-1 font-display text-[clamp(20px,5.4vw,25px)] leading-tight font-extrabold text-white [overflow-wrap:anywhere]">
            {navio.nome}
          </h3>
        </div>
        <span className="pill shrink-0 px-2.5 py-1 font-display text-[11px] font-bold text-ciano">
          {total} {total === 1 ? "operadora" : "operadoras"}
        </span>
      </header>

      <div className="mt-3 space-y-2.5">
        {navio.operadoras.map((op, i) => (
          <div key={`${op.nome}-${i}`} className="rounded-[16px] border border-borda bg-painel/60 p-3">
            <p className="font-display text-[13px] leading-snug font-bold text-gelo [overflow-wrap:anywhere]">
              {op.nome}
            </p>
            <p className="micro mt-1.5 font-display text-[11px] font-extrabold text-ciano">{op.mercadoria}</p>
            <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-borda/60 pt-2.5">
              <span className="text-[12px] text-aco">Saldo da Operadora</span>
              <span className="tabular font-display text-[14px] font-extrabold text-white">{op.saldo}</span>
            </div>
          </div>
        ))}
      </div>

      {navio.descarregado !== null && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-aco">Descarga</span>
            <span className="tabular font-display font-extrabold text-verde">
              {navio.descarregado}% descarregado
            </span>
          </div>
          <div className="progresso-trilho h-2.5 w-full overflow-hidden rounded-full">
            {/* A descarga começa verde (navio cheio), passa pelo amarelo e
                 termina vermelha quando está finalizando — degradê de verde
                 para vermelho revelado à medida que o preenchimento avança. */}
            <div
              className="h-2.5 rounded-full transition-[width] duration-500"
              style={{
                width: `${navio.descarregado}%`,
                background: `linear-gradient(
                  90deg,
                  var(--color-verde) 0%,
                  var(--color-ouro) 40%,
                  var(--color-vermelho) 100%
                )`,
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-borda pt-3">
        <span className="text-[12px] text-aco">Saldo Total do Navio</span>
        <span className="tabular font-display text-[15px] font-extrabold text-white">{navio.saldoTotal}</span>
      </div>
    </article>
  );
}

function corSituacao(situacao: string): string {
  if (situacao.includes("EM ANDAMENTO")) return "border-ciano/60 bg-ciano/10 text-ciano";
  if (situacao.includes("CANCELADA")) return "border-ambar/60 bg-ambar/10 text-ambar";
  if (situacao.includes("A CONFIRMAR")) return "border-ambar/60 bg-ambar/10 text-ambar";
  if (situacao.includes("CONFIRMADA") || situacao.includes("PRÁTICO")) return "border-verde/60 bg-verde/10 text-verde";
  return "border-azulclaro/60 bg-azulclaro/10 text-azulclaro";
}

function CartaoManobra({ m }: { m: ManobraEspelho }) {
  const saindo = m.acao !== "Atracar";
  return (
    <article className="cartao-monitor rounded-[22px] p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[clamp(18px,4.8vw,22px)] leading-tight font-extrabold text-white [overflow-wrap:anywhere]">
            {m.nome}
          </h3>
          <p className="micro mt-1.5 font-display text-[11px] font-extrabold text-ciano">{m.mercadoria}</p>
        </div>
        <span
          className={`pill shrink-0 px-2.5 py-1 font-display text-[11px] font-extrabold ${
            saindo ? "text-ambar" : "text-ciano"
          }`}
        >
          {m.acao}
        </span>
      </header>

      {m.estado && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 font-display text-[11px] font-bold ${
              m.estado === "Atracado"
                ? "border-verde/60 bg-verde/10 text-verde"
                : "border-ciano/60 bg-ciano/10 text-ciano"
            }`}
          >
            {m.estado}
          </span>
        </div>
      )}

      <div className="mt-3 rounded-[16px] border border-borda bg-painel/60 p-3">
        <p className="tabular font-display text-[13.5px] leading-snug font-bold text-gelo [overflow-wrap:anywhere]">
          {m.linha}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-aco">{m.explicacao}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="micro text-discreto">Situação</span>
        <span className={`rounded-full border px-3 py-1 font-display text-[11px] font-extrabold ${corSituacao(m.situacao)}`}>
          {m.situacao}
        </span>
      </div>
    </article>
  );
}

function CartaoFonte({ fonte }: { fonte: PainelEspelho["fontes"][number] }) {
  const aoVivo = fonte.estado === "ao-vivo";
  return (
    <div className="rounded-[16px] border border-borda/70 bg-fundo/40 p-3">
      {/* O acesso ao site oficial vive só aqui, no rodapé. */}
      <a
        href={fonte.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Abrir site oficial · ${fonte.rotulo}`}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-ciano/60 bg-ciano/10 px-3 text-center font-display text-[13px] font-extrabold text-ciano transition-colors hover:bg-ciano/20"
      >
        <ExternalLink size={14} className="shrink-0" /> Site oficial · {fonte.rotulo}
      </a>
      <p className="mt-2 flex items-start gap-2 text-[11.5px] leading-snug text-aco">
        <span aria-hidden className={`led mt-0.5 shrink-0 ${aoVivo ? "led-verde" : "led-aco"}`} />
        <span>
          {aoVivo ? "Leitura ao vivo" : "Última leitura gravada"} · {fonte.atualizadoFonte ?? "—"}
          {fonte.erro ? ` · ${fonte.erro}` : ""}
        </span>
      </p>
    </div>
  );
}

export default function EspelhoNaviosApp({
  vista,
  inicial,
}: {
  vista: Vista;
  inicial: PainelEspelho;
}) {
  const [painel, setPainel] = useState<PainelEspelho>(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/navios/espelho", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const dados = (await r.json()) as PainelEspelho;
      setPainel(dados);
      setErro(null);
    } catch {
      setErro("Não foi possível atualizar agora. Os últimos dados continuam na tela.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void buscar();
    const t = setInterval(() => void buscar(), 30_000);
    return () => clearInterval(t);
  }, [buscar]);

  const portos = useMemo(() => {
    const ordem: string[] = [];
    const grupos = new Map<string, AtracadoEspelho[]>();
    for (const a of painel.atracados) {
      if (!grupos.has(a.porto)) {
        grupos.set(a.porto, []);
        ordem.push(a.porto);
      }
      grupos.get(a.porto)!.push(a);
    }
    return ordem.map((p) => ({ porto: p, navios: grupos.get(p)! }));
  }, [painel.atracados]);

  const contagens = useMemo<Record<Filtro, number>>(
    () => ({
      "Em manobra": painel.manobras.filter((m) => m.estado === "Em manobra").length,
      "Aguardando manobra": painel.manobras.filter((m) => m.aguardando).length,
      Atracado: painel.manobras.filter((m) => m.estado === "Atracado").length,
    }),
    [painel.manobras],
  );

  const manobrasVisiveis = useMemo(() => {
    if (!filtro) return painel.manobras;
    if (filtro === "Em manobra") return painel.manobras.filter((m) => m.estado === "Em manobra");
    if (filtro === "Atracado") return painel.manobras.filter((m) => m.estado === "Atracado");
    return painel.manobras.filter((m) => m.aguardando);
  }, [filtro, painel.manobras]);

  const aoVivo = painel.modo === "ao-vivo";
  const rotuloModo = aoVivo ? "AO VIVO" : painel.modo === "parcial" ? "PARCIAL" : "REFERÊNCIA";

  return (
    <main className="fundo-app min-h-screen bg-fundo pb-10 text-gelo">
      <div className="largura-aparelho px-3 pt-4 sm:px-5">
        <header className="rounded-[24px] border border-borda bg-cartao p-4">
          <div className="flex items-center justify-between gap-3">
            <img
              src={LOGO.src}
              alt="COPALINKS"
              width={LOGO.largura}
              height={LOGO.altura}
              className="h-auto w-[min(185px,52vw)]"
            />
            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-borda px-3 py-2 font-display text-[12px] font-bold text-aco transition-colors hover:border-ciano/60 hover:text-ciano"
            >
              <ArrowLeft size={14} /> CopaLinks
            </Link>
          </div>

          {/* Na tela inicial a referência mostra só a logo, os dois botões e o
              "Atualizado …": o título fica apenas para leitores de tela. Já a
              tela SINPRAPAR abre com o cabeçalho "SINPRAPAR" e o subtítulo
              "Manobras previstas — fertilizantes", exatamente como a origem. */}
          {vista === "atracados" ? (
            <h1 className="sr-only">COPALINKS — Navios Atracados</h1>
          ) : (
            <>
              <h1 className="mt-3 font-display text-[clamp(18px,5vw,23px)] leading-tight font-extrabold text-white">
                SINPRAPAR
              </h1>
              <p className="mt-1 text-[13px] text-aco">Manobras previstas — fertilizantes</p>
            </>
          )}

          {/* Só a navegação interna fica no topo. Os acessos aos sites
              oficiais ficam no rodapé (uma única vez), junto do status das
              fontes — nada de link externo repetido aqui em cima. */}
          <div className="mt-4">
            {vista === "atracados" ? (
              <Link
                href="/navios/sinprapar"
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full border border-ciano/70 bg-ciano/10 px-3 text-center font-display text-[13px] font-extrabold text-ciano transition-colors hover:bg-ciano/20"
              >
                <Ship size={16} /> Manobras Previstas
              </Link>
            ) : (
              <Link
                href="/navios"
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full border border-ciano/70 bg-ciano/10 px-3 text-center font-display text-[13px] font-extrabold text-ciano transition-colors hover:bg-ciano/20"
              >
                <Anchor size={16} /> Navios Atracados
              </Link>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-borda/60 pt-3" aria-live="polite">
            <span aria-hidden className={`led ${aoVivo ? "led-verde led-pulsante" : "led-ambar"}`} />
            <Clock size={14} className="text-discreto" />
            <span className="tabular text-[12.5px] text-gelo">Atualizado {horaPorto(painel.atualizadoEm)}</span>
            <span
              className={`rounded-full border px-2 py-0.5 font-display text-[10px] font-extrabold ${
                aoVivo
                  ? "border-verde/60 bg-verde/10 text-verde"
                  : painel.modo === "parcial"
                    ? "border-ambar/60 bg-ambar/10 text-ambar"
                    : "border-azulclaro/60 bg-azulclaro/10 text-azulclaro"
              }`}
            >
              {rotuloModo}
            </span>
            <button
              type="button"
              onClick={() => void buscar()}
              disabled={carregando}
              aria-label="Atualizar agora"
              title="Atualizar agora"
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-borda text-aco transition-colors hover:border-ciano/60 hover:text-ciano disabled:opacity-50"
            >
              <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
            </button>
          </div>

          {painel.aviso && (
            <p className="mt-3 flex items-start gap-2 rounded-[14px] border border-ambar/40 bg-ambar/10 px-3 py-2.5 text-[12px] leading-snug text-gelo">
              <Info size={14} className="mt-0.5 shrink-0 text-ambar" />
              {painel.aviso}
            </p>
          )}
          {erro && (
            <p className="mt-2 flex items-start gap-2 rounded-[14px] border border-ambar/40 bg-ambar/10 px-3 py-2.5 text-[12px] leading-snug text-gelo">
              <Info size={14} className="mt-0.5 shrink-0 text-ambar" />
              {erro}
            </p>
          )}
        </header>

        {vista === "atracados" ? (
          <section aria-label="Navios atracados de fertilizantes">
            {portos.length === 0 && (
              <div className="cartao-monitor mt-6 rounded-[22px] p-6 text-center">
                <Ship size={28} className="mx-auto text-discreto" />
                <p className="mt-3 text-[14px] text-aco">Nenhum navio de fertilizante atracado no momento.</p>
              </div>
            )}
            {portos.map(({ porto, navios }) => (
              <div key={porto}>
                <TituloGrupo extra={`${navios.length} ${navios.length === 1 ? "navio" : "navios"}`}>
                  {porto}
                </TituloGrupo>
                <div className="space-y-3">
                  {navios.map((n) => (
                    <CartaoAtracado key={`${n.programacao}:${n.nome}`} navio={n} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <section aria-label="Manobras previstas de navios de fertilizantes">
            <div className="mt-5 flex flex-wrap gap-2">
              {FILTROS.map((f) => {
                const ativo = filtro === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(ativo ? null : f)}
                    aria-pressed={ativo}
                    className={`rounded-full border px-3 py-2 font-display text-[12px] font-bold transition-colors ${
                      ativo
                        ? "border-ciano bg-ciano/15 text-ciano"
                        : "border-borda bg-cartao text-aco hover:border-ciano/60 hover:text-gelo"
                    }`}
                  >
                    {f} <span className="tabular opacity-75">{contagens[f]}</span>
                  </button>
                );
              })}
            </div>
            {filtro && (
              <button
                type="button"
                onClick={() => setFiltro(null)}
                className="mt-2 text-[12px] font-semibold text-ciano hover:underline"
              >
                Limpar filtro · mostrar todas
              </button>
            )}

            <div className="mt-4 space-y-3">
              {manobrasVisiveis.length === 0 && (
                <div className="cartao-monitor rounded-[22px] p-6 text-center">
                  <Ship size={28} className="mx-auto text-discreto" />
                  <p className="mt-3 text-[14px] text-aco">Nenhuma manobra de fertilizante neste filtro.</p>
                </div>
              )}
              {manobrasVisiveis.map((m, i) => (
                <CartaoManobra key={`${m.nome}:${m.data}:${m.hora}:${i}`} m={m} />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-8 rounded-[22px] border border-borda bg-cartao/70 p-4">
          <h2 className="micro font-display text-[11px] font-extrabold text-aco">
            Acessos aos sites oficiais · 2 fontes · somente fertilizantes
          </h2>
          <div className="mt-3 grid gap-2">
            {painel.fontes.map((f) => (
              <CartaoFonte key={f.id} fonte={f} />
            ))}
          </div>
          <Link
            href="/"
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-borda font-display text-[13px] font-bold text-gelo transition-colors hover:border-ciano/60 hover:text-ciano"
          >
            <ArrowLeft size={15} /> Voltar ao CopaLinks
          </Link>
        </footer>
      </div>
    </main>
  );
}
