"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudRain,
  Droplet,
  Droplets,
  ExternalLink,
  MapPin,
  Navigation2,
  RefreshCw,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import type { Dia, Hora, Previsao } from "@/lib/tempo";
import { IconeGrande, IconeLinha } from "@/components/tempo/IconeTempo";

const SIMPORT_PAINEL = "https://weather-appa.app.simport.com.br/forecast";

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

/** Seta do vento: aponta para onde o vento vai (graus de onde ele vem + 180). */
function SetaVento({ graus, tamanho = 14 }: { graus: number; tamanho?: number }) {
  return (
    <Navigation2
      size={tamanho}
      strokeWidth={0}
      className="shrink-0 fill-current"
      style={{ transform: `rotate(${graus + 180}deg)` }}
      aria-hidden
    />
  );
}

function Tile({
  icone,
  rotulo,
  valor,
  sub,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[14px] border border-[#2a5bb0]/55 bg-[#071a3d]/75 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[#38b6ff] [&>svg]:h-5 [&>svg]:w-5">{icone}</span>
        <span className="min-w-0 text-[12.5px] leading-tight text-gelo/85">{rotulo}</span>
      </div>
      <div className="min-w-0">
        <div className="tabular mt-1.5 font-display text-[clamp(20px,6vw,24px)] leading-tight font-bold text-white">
          {valor}
        </div>
        {sub && <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#5cc8ff]">{sub}</div>}
      </div>
    </div>
  );
}

function CardHora({ h, ativo }: { h: Hora; ativo: boolean }) {
  return (
    <div
      data-dia={h.dia}
      className={`relative flex w-[76px] shrink-0 snap-start flex-col items-center gap-1 overflow-hidden rounded-[16px] border px-1.5 pt-2.5 pb-3 ${
        ativo
          ? "border-[#38b6ff]/80 bg-[#0e2c63]/90"
          : "border-[#2a5bb0]/55 bg-[#071a3d]/75"
      }`}
    >
      <span className="tabular text-[15px] font-semibold text-white">{h.hora}</span>
      <IconeLinha icone={h.icone} tamanho={28} className="my-0.5" />
      <span className="tabular font-display text-[18px] font-bold text-white">{h.temperatura}°C</span>
      <span className="tabular flex items-center gap-0.5 text-[13px] text-white">
        <Droplet size={12} className="text-[#5cc8ff]" /> {h.chanceChuva}%
      </span>
      <span className="tabular text-[12.5px] text-gelo/85">{h.chuvaMm} mm</span>
      <span className="tabular flex items-center gap-1 text-[12.5px] text-gelo/90" title={`Vento ${h.ventoDirecao}`}>
        <SetaVento graus={h.ventoGraus} tamanho={12} /> {h.ventoKmh}
      </span>
      {ativo && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#38b6ff]" />}
    </div>
  );
}

function CardDia({
  d,
  selecionado,
  onClick,
}: {
  d: Dia;
  selecionado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecionado}
      className={`flex w-[132px] shrink-0 snap-start flex-col rounded-[16px] border px-3 pt-2.5 pb-3 text-left transition-colors ${
        selecionado
          ? "border-[#38b6ff]/80 bg-[#0e2c63]/90"
          : "border-[#2a5bb0]/55 bg-[#071a3d]/75 hover:border-[#38b6ff]/60"
      }`}
    >
      <span className="font-display text-[16px] font-bold text-white">{d.rotulo}</span>
      <span className="text-[12px] text-gelo/75">{d.dataCurta}</span>
      <IconeLinha icone={d.icone} tamanho={34} className="mt-2" />
      <span className="mt-1.5 min-h-[34px] text-[13px] leading-tight text-white">
        {d.descricao}
        {d.chuvaMm > 0 && <span className="block text-gelo/80">{d.chuvaMm} mm</span>}
      </span>
      <span className="tabular mt-1 font-display text-[18px] font-bold text-white">
        {d.max}° <span className="text-gelo/70">/ {d.min}°</span>
      </span>
      <span className="tabular mt-1 flex items-center gap-1 text-[13px] text-[#5cc8ff]">
        <Droplets size={14} /> {d.chanceChuva}%
      </span>
    </button>
  );
}

/** Faixa horizontal com rolagem e esmaecimento nas bordas. */
function Faixa({
  children,
  refFaixa,
}: {
  children: React.ReactNode;
  refFaixa?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="relative -mx-3">
      <div
        ref={refFaixa}
        className="rolagem-horizontal flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-3 pb-1"
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#08183a] to-transparent" />
    </div>
  );
}

export default function TempoApp({ inicial }: { inicial: Previsao | null }) {
  const [p, setP] = useState<Previsao | null>(inicial);
  const [carregando, setCarregando] = useState(!inicial);
  const [erro, setErro] = useState("");
  const [boletimAberto, setBoletimAberto] = useState(false);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const faixaHoras = useRef<HTMLDivElement>(null);

  const buscar = useCallback(async (forcar = false) => {
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch(`/api/tempo${forcar ? "?forcar=1" : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || d.erro) throw new Error(d.erro ?? "Previsão indisponível.");
      setP(d);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Previsão indisponível.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!inicial) void buscar();
    const t = setInterval(() => void buscar(), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [inicial, buscar]);

  /** Tocar num dia leva a faixa de horas até ele. */
  function escolherDia(d: Dia) {
    setDiaSel(d.data);
    const faixa = faixaHoras.current;
    const alvo = faixa?.querySelector<HTMLElement>(`[data-dia="${d.data}"]`);
    if (faixa && alvo) faixa.scrollTo({ left: alvo.offsetLeft - 12, behavior: "smooth" });
  }

  const a = p?.agora;
  const alertaCor =
    p?.alerta.nivel === "tempo-bom"
      ? { borda: "border-verde/60", barra: "bg-verde", texto: "text-verde" }
      : p?.alerta.nivel === "vento"
        ? { borda: "border-ambar/60", barra: "bg-ambar", texto: "text-ambar" }
        : { borda: "border-[#38b6ff]/60", barra: "bg-[#38b6ff]", texto: "text-[#38b6ff]" };

  return (
    <div className="fundo-app relative min-h-screen w-full bg-[#002b6b]">

      <main className="relative mx-auto w-full max-w-[360px] pb-10">
        {/* ------------------------------------------------ cabeçalho */}
        <header className="relative overflow-x-clip px-4 pt-4 pb-5">
          <div aria-hidden className="imagem-degrade pointer-events-none absolute inset-x-0 top-0 -bottom-4 overflow-hidden">
            <img
              src="/images/tempo-topo.webp"
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover object-right"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,18,52,0.88)_0%,rgba(0,28,78,0.55)_55%,rgba(0,28,78,0.12)_100%),linear-gradient(180deg,transparent_48%,rgba(0,43,107,0.75)_78%,#002b6b_100%)]" />
          </div>
          <div className="relative flex items-center gap-3">
            <IconeLinha icone="sol-nuvem" tamanho={44} className="!text-[#ffc83d]" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[clamp(20px,6vw,27px)] leading-tight font-bold text-white">
                Tempo em {p?.cidade ?? "Paranaguá"}
              </h1>
              <p className="text-[15px] text-azulclaro">
                {p?.uf ?? "PR"} <span className="mx-1.5">•</span> Brasil
              </p>
            </div>
            <button
              type="button"
              onClick={() => void buscar(true)}
              aria-label="Atualizar previsão"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60"
            >
              <RefreshCw size={22} strokeWidth={2.4} className={carregando ? "animate-spin" : ""} />
            </button>
            <Link
              href="/"
              aria-label="Fechar"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60"
            >
              <X size={24} strokeWidth={2.6} />
            </Link>
          </div>
        </header>

        <div className="space-y-3 px-3">
          {!p && (
            <section className="painel p-6 text-center">
              {erro ? (
                <>
                  <p className="font-display text-[17px] font-bold text-white">Previsão indisponível</p>
                  <p className="mt-1 text-[14px] text-gelo/75">{erro}</p>
                  <button type="button" onClick={() => void buscar(true)} className="ouro mt-4 rounded-full px-5 py-2.5 font-display font-extrabold uppercase">
                    Tentar de novo
                  </button>
                </>
              ) : (
                <p className="text-[15px] text-gelo/80">Buscando a previsão da APPA…</p>
              )}
            </section>
          )}

          {p && a && (
            <>
              {/* ---------------------------------------------- agora */}
              <section className="rounded-[22px] border border-[#2a5bb0]/60 bg-[linear-gradient(180deg,rgba(13,40,92,0.92),rgba(8,24,60,0.94))] p-3.5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)]">
                <div className="flex items-start gap-2">
                  <IconeGrande icone={a.icone} className="h-[92px] w-[96px] shrink-0 drop-shadow-[0_0_18px_rgba(90,180,255,0.35)] min-[440px]:h-[112px] min-[440px]:w-[118px]" />
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-[#2a5bb0]/70 bg-[#06122b]/80 px-2.5 py-1 text-[12.5px] text-gelo/85 min-[440px]:hidden">
                      Agora <b className="tabular text-white">{a.hora}</b>
                    </div>
                    <div className="tabular font-display text-[clamp(46px,14vw,70px)] leading-[0.95] font-extrabold text-white">
                      {a.temperatura}°C
                    </div>
                    <div className="font-display text-[clamp(20px,6vw,26px)] font-semibold text-white">{a.descricao}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[14px] text-gelo/90">
                      <Thermometer size={16} className="shrink-0" /> Sensação térmica <b className="tabular text-white">{a.sensacao}°C</b>
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 rounded-[18px] border border-[#2a5bb0]/70 bg-[#06122b]/80 px-3 py-1.5 min-[440px]:flex">
                    <IconeLinha icone={a.icone} tamanho={24} />
                    <div className="leading-tight">
                      <div className="text-[12.5px] text-gelo/85">Agora</div>
                      <div className="tabular font-display text-[17px] font-bold text-white">{a.hora}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 min-[440px]:grid-cols-3">
                  <Tile icone={<Droplet size={24} />} rotulo="Umidade" valor={`${a.umidade}%`} />
                  <Tile icone={<CloudRain size={24} />} rotulo="Chance de chuva" valor={`${a.chanceChuva}%`} />
                  <Tile icone={<Thermometer size={24} />} rotulo="Sensação térmica" valor={`${a.sensacao}°C`} />
                  <Tile
                    icone={<Wind size={24} />}
                    rotulo="Vento"
                    valor={`${a.ventoKmh} km/h`}
                    sub={
                      <>
                        <SetaVento graus={a.ventoGraus} /> {a.ventoDirecao}
                      </>
                    }
                  />
                  <Tile
                    icone={<Wind size={24} />}
                    rotulo="Rajadas"
                    valor={`${a.rajadaKmh} km/h`}
                    sub={
                      <>
                        <SetaVento graus={a.ventoGraus} /> {a.ventoDirecao}
                      </>
                    }
                  />
                  <Tile
                    icone={<CloudRain size={24} />}
                    rotulo="Chuva acumulada"
                    valor={a.chuva24h === null ? "—" : `${a.chuva24h} mm`}
                    sub={<span className="text-gelo/70">(últimas 24h)</span>}
                  />
                </div>

                {/* alerta + boletim da APPA */}
                <button
                  type="button"
                  onClick={() => setBoletimAberto((v) => !v)}
                  aria-expanded={boletimAberto}
                  className={`mt-3 flex w-full items-center gap-3 overflow-hidden rounded-[16px] border bg-[#06122b]/80 py-3 pr-3 text-left ${alertaCor.borda}`}
                >
                  <span className={`h-12 w-1 shrink-0 rounded-r-full ${alertaCor.barra}`} />
                  <CloudRain size={28} className={`shrink-0 ${alertaCor.texto}`} />
                  <span className="h-10 w-px shrink-0 bg-[#2a5bb0]/70" />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-display text-[16px] font-bold uppercase ${alertaCor.texto}`}>
                      {p.alerta.titulo}
                    </span>
                    <span className="block text-[14px] leading-snug text-white">{p.alerta.texto}</span>
                  </span>
                  {boletimAberto ? (
                    <ChevronDown size={22} className="shrink-0 text-azulclaro" />
                  ) : (
                    <ChevronRight size={22} className="shrink-0 text-azulclaro" />
                  )}
                </button>
                <AnimatePresence>
                  {boletimAberto && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-2 rounded-[16px] border border-[#2a5bb0]/55 bg-[#06122b]/70 p-3">
                        <div className="text-[12px] font-bold tracking-[0.08em] text-azulclaro uppercase">
                          Boletim meteorológico APPA
                        </div>
                        {p.boletim.length === 0 && <p className="text-[14px] text-gelo/75">Sem boletim publicado.</p>}
                        {p.boletim.map((b) => (
                          <p key={b.data} className="text-[14px] leading-relaxed text-gelo/90">
                            <b className="text-white">
                              {new Date(`${b.data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}:
                            </b>{" "}
                            {b.texto}
                            {b.tempoRuim && <span className="ml-1 font-bold text-ambar">(tempo ruim)</span>}
                          </p>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* --------------------------------------- próximas horas */}
              <section className="rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                  <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
                    <Clock size={26} strokeWidth={2.2} /> Próximas horas
                  </h2>
                  <a
                    href={SIMPORT_PAINEL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[13.5px] text-gelo/85 hover:text-white"
                  >
                    Mais detalhes <ChevronRight size={18} />
                  </a>
                </div>
                <Faixa refFaixa={faixaHoras}>
                  {p.horas.map((h, i) => (
                    <CardHora key={h.ts} h={h} ativo={diaSel ? h.dia === diaSel : i === 0} />
                  ))}
                </Faixa>
              </section>

              {/* ----------------------------------------- próximos dias */}
              <section className="rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                  <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
                    <CalendarDays size={26} strokeWidth={2.2} /> Próximos dias
                  </h2>
                  <span className="flex items-center gap-1 text-[13.5px] text-gelo/85">
                    {p.dias.length} dias <ChevronRight size={18} />
                  </span>
                </div>
                <Faixa>
                  {p.dias.map((d) => (
                    <CardDia key={d.data} d={d} selecionado={diaSel === d.data} onClick={() => escolherDia(d)} />
                  ))}
                </Faixa>
                <p className="mt-2 px-0.5 text-[12px] text-gelo/60">
                  Arraste para o lado para ver a semana. Toque num dia para ver as horas dele.
                </p>
              </section>

              {/* ---------------------------------------------- rodapé */}
              <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 pt-1 text-[12.5px] text-gelo/80">
                <span className="flex items-center gap-1">
                  <MapPin size={14} className="text-azulclaro" /> {p.cidade} – {p.uf}
                </span>
                {p.nascerSol && p.porSol && (
                  <span className="flex items-center gap-1.5">
                    <Sunrise size={15} className="text-[#ffc83d]" /> Nascer do sol: {p.nascerSol}
                    <span className="text-gelo/40">|</span>
                    <Sunset size={15} className="text-[#ff9f43]" /> Pôr do sol: {p.porSol}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <RefreshCw size={13} className="text-azulclaro" /> Atualizado em {hora(p.atualizadoEm)}
                </span>
                <a
                  href={SIMPORT_PAINEL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-1 text-[11.5px] text-gelo/55 hover:text-gelo/85"
                >
                  Dados: SIMPORT® · APPA{p.fontes.estacao ? " (estação do porto)" : ""}
                  {p.fontes.composio ? " · Composio (tempo atual)" : ""}
                  {p.fontes.openMeteo ? " · Open-Meteo (dias seguintes)" : ""}
                  <ExternalLink size={11} />
                </a>
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
