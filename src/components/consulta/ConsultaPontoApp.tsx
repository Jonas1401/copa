"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, Info, Percent, RefreshCw, ScrollText } from "lucide-react";
import { PORCENTAGENS, brl, lerPorcentagem, num, toneladas } from "@/lib/frete";
import {
  avisoDaPagina,
  diaMesDe,
  horaDaLeitura,
  pontosLidos,
  rotuloDaSemana,
  textoDeViagens,
  type PontoDoResumo,
  type ResumoDoTicket,
} from "@/lib/ticket-card";
import { useResumoDoTicket } from "@/components/consulta/useResumoDoTicket";

/**
 * SALDO DE GANHOS — as viagens da semana do motorista.
 *
 * O servidor lê a aba “Ticket” do Portal do Motorista com a conta do próprio
 * motorista (a cada 5 minutos) e esta tela mostra: quantas viagens, o valor
 * bruto e a comissão — a mesma conta do “Cálculo de Frete”. Aqui o motorista
 * cadastra a porcentagem dele (é o que liga a consulta).
 */

/** A porcentagem que o motorista já usa na calculadora de frete (só para sugerir). */
const CHAVE_PORCENTAGEM_DO_FRETE = "copalinks-frete-porcentagem-v1";

type Mensagem = { texto: string; erro: boolean };
type Ocupado = null | "salvar" | "atualizar" | "desligar";

/** Valor em dinheiro nos dois quadros do topo: quanto mais comprido, menor a letra (nunca cortado). */
const letraDoValor = (texto: string) =>
  texto.length > 11 ? "text-[clamp(15px,4.3vw,19px)]" : "text-[clamp(17px,5.2vw,22px)]";

function Bloco({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`painel p-4 ${className}`}>{children}</section>;
}

/** As viagens de um ponto: uma linha por viagem, com o frete (Quant × Valor) de cada uma. */
function ViagensDoPonto({ p }: { p: PontoDoResumo }) {
  const viagens = p.viagens ?? [];
  if (!viagens.length) {
    return <p className="mt-3 rounded-[14px] border border-[#183341]/70 bg-[#071A28]/70 px-3 py-2.5 text-[13.5px] text-gelo/80">Nenhuma viagem lançada nesta semana.</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-[16px] border border-[#183341]/70">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#071A28] text-left text-[11px] tracking-[0.06em] text-gelo/75 uppercase">
            <th className="py-2 pl-3 font-semibold">Data</th>
            <th className="py-2 text-right font-semibold">Quant</th>
            <th className="py-2 text-right font-semibold">Valor</th>
            <th className="py-2 pr-3 text-right font-semibold">Frete</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {viagens.map((v, i) => (
            <tr key={`${v.data}-${v.hora}-${i}`} className={i % 2 ? "bg-white/[0.03]" : ""}>
              <td className="py-2 pl-3">
                <span className="block font-semibold text-white">
                  {diaMesDe(v.data)} <span className="text-gelo/75">{v.hora}</span>
                </span>
                {v.servico && <span className="block text-[11px] leading-tight text-gelo/60 [overflow-wrap:anywhere]">{v.servico}</span>}
              </td>
              <td className="py-2 text-right text-white">{toneladas(v.quant)}</td>
              <td className="py-2 text-right text-white">{num(v.valor)}</td>
              <td className="py-2 pr-3 text-right font-bold text-white">{brl(v.quant * v.valor)}</td>
            </tr>
          ))}
        </tbody>
        {p.conta && (
          <tfoot className="tabular">
            <tr className="border-t border-[#183341]/70 bg-[#071A28] font-bold">
              <td className="py-2.5 pl-3 text-gelo/80">Total</td>
              <td className="py-2.5 text-right text-white">{toneladas(p.conta.toneladas)}</td>
              <td />
              <td className="py-2.5 pr-3 text-right text-white">{brl(p.conta.bruto)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function ConsultaPontoApp() {
  const { resumo, naoLogado, carregado, agora, receber } = useResumoDoTicket(true);
  /** O que está digitado no campo da porcentagem (null = o motorista ainda não mexeu). */
  const [texto, setTexto] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [sugestao, setSugestao] = useState("");
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Quem já usa a calculadora de frete tem a porcentagem neste aparelho: ela entra como sugestão.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const guardada = localStorage.getItem(CHAVE_PORCENTAGEM_DO_FRETE) ?? "";
        if (lerPorcentagem(guardada) !== null) setSugestao(guardada.replace(".", ","));
      } catch {
        /* sem armazenamento local: sem sugestão */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const pctSalva = resumo?.porcentagem ?? null;
  const campo = texto ?? (pctSalva !== null ? num(pctSalva) : sugestao);
  const pctDoCampo = lerPorcentagem(campo);
  const mostrarFormulario = Boolean(resumo) && (editando || !resumo?.ligado);

  async function chamar(metodo: "POST" | "PUT" | "DELETE", qual: Exclude<Ocupado, null>, corpo?: unknown) {
    if (ocupado) return null;
    setOcupado(qual);
    setMensagem(null);
    try {
      const r = await fetch("/api/tickets", {
        method: metodo,
        ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
      });
      const dados = (await r.json().catch(() => ({}))) as Partial<ResumoDoTicket> & { erro?: string; mensagem?: string; leu?: boolean };
      if (!r.ok) {
        setMensagem({ texto: dados?.erro ?? "Não foi possível agora. Tente de novo em instantes.", erro: true });
        return null;
      }
      if ("ligado" in dados) receber(dados as ResumoDoTicket);
      return dados;
    } catch {
      setMensagem({ texto: "Sem conexão. Tente de novo em instantes.", erro: true });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function salvar() {
    if (pctDoCampo === null) {
      setMensagem({ texto: "Digite a sua porcentagem (por exemplo 18 ou 18,5).", erro: true });
      return;
    }
    const dados = await chamar("POST", "salvar", { porcentagem: campo });
    if (!dados) return;
    setEditando(false);
    setTexto(null);
    setMensagem({ texto: dados.mensagem ?? "Porcentagem salva.", erro: false });
  }

  async function atualizar() {
    const dados = await chamar("PUT", "atualizar");
    // Verde só quando a leitura veio; “espere uns segundos” e “não veio” ficam em âmbar.
    if (dados?.mensagem) setMensagem({ texto: dados.mensagem, erro: dados.leu !== true });
  }

  async function desligar() {
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    setConfirmando(false);
    const dados = await chamar("DELETE", "desligar");
    if (!dados) return;
    setTexto(null);
    setEditando(false);
    setMensagem({ texto: "Saldo de Ganhos desligado. A sua porcentagem e as viagens guardadas foram apagadas.", erro: false });
  }

  const aviso = resumo ? avisoDaPagina(resumo, agora) : null;
  const temLeitura = Boolean(resumo && resumo.semana && pontosLidos(resumo) > 0);
  const podeAtualizar = Boolean(resumo?.ligado && resumo.disponivel && resumo.temAcesso && resumo.totalPontos);
  // Com um ponto só, as viagens já aparecem abertas.
  const pontoAberto = aberto ?? (resumo && resumo.pontos.length === 1 ? resumo.pontos[0].codigo : null);

  return (
    <div className="fundo-app relative min-h-screen w-full bg-fundo">
      <main className="largura-aparelho relative px-3 pt-4 pb-12">
        {/* cabeçalho */}
        <header className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Voltar ao início"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#183341]/70 bg-[#071A28]/80 text-white transition-colors hover:border-ciano/70 hover:text-ciano"
          >
            <ChevronLeft size={26} strokeWidth={2.2} />
          </Link>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#00B8BC] text-[#000D16] shadow-[0_0_22px_-4px_rgba(0,184,188,0.8)]">
            <ScrollText size={22} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(20px,6vw,26px)] leading-tight font-extrabold text-white">Saldo de Ganhos</h1>
            <p className="text-[13.5px] text-gelo/80">Viagens da semana · Ticket do portal</p>
          </div>
        </header>

        <div className="mt-4 space-y-3">
          {!carregado && <p className="px-1 text-[14px] text-gelo/75">Carregando…</p>}

          {carregado && naoLogado && (
            <Bloco>
              <p className="text-[14.5px] leading-snug text-gelo/90">
                Para ver as suas viagens, entre com o seu cadastro na tela inicial e cadastre o seu ponto.
              </p>
              <Link href="/" className="ouro mt-3 flex h-[48px] w-full items-center justify-center rounded-full font-display text-[16px] font-extrabold tracking-[0.03em] uppercase">
                Ir para o início
              </Link>
            </Bloco>
          )}

          {carregado && !naoLogado && !resumo && (
            <p className="flex items-start gap-2 rounded-[16px] border border-ambar/50 bg-ambar/10 px-4 py-3 text-[14px] text-gelo/90">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-ambar" /> Não consegui carregar agora. Confira a conexão; eu tento de novo sozinho.
            </p>
          )}

          {resumo && (
            <>
              {/* os três números */}
              <section className="cartao-monitor relative overflow-hidden rounded-[24px] px-4 py-4" data-ticket="resumo">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold tracking-[0.04em] text-gelo/75 uppercase">Semana</div>
                    <div className="tabular font-display text-[20px] leading-tight font-extrabold text-white">
                      {temLeitura && resumo.semana ? rotuloDaSemana(resumo.semana) : "—"}
                    </div>
                  </div>
                  {podeAtualizar && (
                    <button
                      type="button"
                      onClick={() => void atualizar()}
                      disabled={ocupado !== null}
                      className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-[#183341] bg-[#002F3B] px-4 font-display text-[14.5px] font-bold text-white transition-colors hover:border-ciano/70 disabled:opacity-50"
                    >
                      <RefreshCw size={16} strokeWidth={2.4} className={ocupado === "atualizar" ? "animate-spin" : ""} />
                      {ocupado === "atualizar" ? "Lendo…" : "Atualizar"}
                    </button>
                  )}
                </div>

                <div className="mt-4 flex items-baseline justify-between gap-3">
                  <div className={`tabular font-display text-[clamp(30px,9.5vw,40px)] leading-none font-black ${temLeitura ? "text-white" : "text-gelo/45"}`}>
                    {temLeitura ? textoDeViagens(resumo.conta.viagens) : "— viagens"}
                  </div>
                  {temLeitura && resumo.conta.viagens > 0 && (
                    <div className="tabular shrink-0 text-[13.5px] font-semibold text-gelo/75">{toneladas(resumo.conta.toneladas)} t</div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-[16px] border border-[#183341]/70 bg-[#000D16]/50 px-3 py-2.5">
                    <div className="text-[12px] font-medium text-gelo/80">Valor bruto</div>
                    <div className={`tabular mt-0.5 font-display ${letraDoValor(brl(resumo.conta.bruto))} leading-tight font-extrabold text-white [overflow-wrap:anywhere]`}>
                      {temLeitura ? brl(resumo.conta.bruto) : "—"}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[16px] border border-ouro/40 bg-[#000D16]/50 px-3 py-2.5">
                    <div className="text-[12px] font-medium text-gelo/80">
                      Comissão{pctSalva !== null ? <span className="tabular text-gelo/65"> · {num(pctSalva)}%</span> : null}
                    </div>
                    <div className={`tabular mt-0.5 font-display ${letraDoValor(brl(resumo.conta.comissao))} leading-tight font-extrabold text-ouro [overflow-wrap:anywhere]`}>
                      {temLeitura && pctSalva !== null ? brl(resumo.conta.comissao) : "—"}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-[12.5px] leading-snug text-gelo/70">
                  {temLeitura && resumo.lidoEm ? (
                    <>
                      Lido no portal: <span className={`tabular font-semibold ${resumo.recente ? "text-gelo/90" : "text-ambar"}`}>{horaDaLeitura(resumo.lidoEm, agora)}</span>
                      {resumo.ligado && resumo.disponivel ? ` · atualiza sozinho a cada ${resumo.intervaloMin} min` : ""}
                    </>
                  ) : resumo.ligado ? (
                    "Ainda sem leitura do portal."
                  ) : (
                    "Cadastre a sua porcentagem para eu começar a ler as suas viagens."
                  )}
                </p>
              </section>

              {aviso && (
                <div
                  className={`flex items-start gap-2 rounded-[16px] border px-4 py-3 text-[14px] leading-snug ${
                    aviso.tom === "atencao" ? "border-ambar/50 bg-ambar/10 text-gelo/95" : "border-[#183341] bg-[#071A28]/80 text-gelo/90"
                  }`}
                >
                  {aviso.tom === "atencao" ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-ambar" /> : <Info size={18} className="mt-0.5 shrink-0 text-ciano" />}
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    {aviso.texto}
                    {aviso.acao === "portal" && (
                      <Link href="/?portal=1" className="mt-2 block font-display text-[15px] font-extrabold text-ciano underline underline-offset-4">
                        Cadastrar o acesso ao portal
                      </Link>
                    )}
                    {aviso.acao === "inicio" && (
                      <Link href="/" className="mt-2 block font-display text-[15px] font-extrabold text-ciano underline underline-offset-4">
                        Ir para o início
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {mensagem && (
                <p
                  role="status"
                  aria-live="polite"
                  className={`flex items-start gap-2 rounded-[16px] border px-4 py-3 text-[14px] leading-snug [overflow-wrap:anywhere] ${
                    mensagem.erro ? "border-ambar/50 bg-ambar/10 text-gelo/95" : "border-verde/40 bg-verde/10 text-gelo/95"
                  }`}
                >
                  {mensagem.erro ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-ambar" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-verde" />}
                  <span className="min-w-0">{mensagem.texto}</span>
                </p>
              )}

              {/* porcentagem */}
              <Bloco>
                <div className="flex items-end justify-between gap-3">
                  <span className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[0.03em] text-white uppercase">
                    <Percent size={17} className="text-ouro" /> Sua porcentagem
                  </span>
                  <span className="tabular font-display text-[30px] leading-none font-black text-ouro">
                    {mostrarFormulario ? (pctDoCampo !== null ? `${num(pctDoCampo)}%` : "—") : pctSalva !== null ? `${num(pctSalva)}%` : "—"}
                  </span>
                </div>

                {mostrarFormulario ? (
                  <>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {PORCENTAGENS.map((v) => {
                        const ativo = pctDoCampo === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setTexto(String(v))}
                            aria-pressed={ativo}
                            className={`rounded-[14px] py-3 font-display text-[16px] font-black transition-transform active:scale-95 ${
                              ativo ? "ouro" : "border border-[#183341]/80 bg-[#071A28]/80 text-white hover:border-ciano/60"
                            }`}
                          >
                            {v}%
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-[14px] border-[1.5px] border-[#183341]/80 bg-[#071A28]/80 px-4 py-3 focus-within:border-ciano/70">
                      <input
                        value={campo}
                        onChange={(e) => setTexto(e.target.value)}
                        inputMode="decimal"
                        aria-label="Sua porcentagem"
                        placeholder="Outro valor..."
                        className="tabular min-w-0 flex-1 bg-transparent font-display text-[16px] font-black text-white outline-none placeholder:text-gelo/40"
                      />
                      <span className="font-black text-gelo/70">%</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void salvar()}
                        disabled={ocupado !== null || pctDoCampo === null}
                        className="ouro flex h-[52px] flex-1 items-center justify-center rounded-full font-display text-[17px] font-extrabold tracking-[0.04em] uppercase disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {ocupado === "salvar" ? "Salvando…" : resumo.ligado ? "Salvar" : "Salvar e ligar"}
                      </button>
                      {resumo.ligado && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditando(false);
                            setTexto(null);
                          }}
                          disabled={ocupado !== null}
                          className="h-[52px] rounded-full border border-[#183341] px-5 font-display text-[15px] font-bold text-gelo/85 hover:border-ciano/60 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                    {!resumo.ligado && (
                      <p className="mt-3 text-[12.5px] leading-snug text-gelo/70">
                        Ao salvar, eu passo a abrir a aba “Ticket” do Portal do Motorista com a sua conta, a cada {resumo.intervaloMin} minutos, só para ler as viagens da semana.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-[13px] leading-snug text-gelo/75">A comissão é esta porcentagem do valor bruto.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditando(true);
                        setMensagem(null);
                      }}
                      className="shrink-0 rounded-full border border-[#183341] px-4 py-2 font-display text-[14.5px] font-bold text-white hover:border-ciano/60"
                    >
                      Trocar
                    </button>
                  </div>
                )}
              </Bloco>

              {/* por ponto */}
              {resumo.ligado && resumo.pontos.length > 0 && (
                <Bloco>
                  <h2 className="font-display text-[15px] font-extrabold tracking-[0.03em] text-white uppercase">
                    {resumo.pontos.length === 1 ? "Viagens do ponto" : `Por ponto (${resumo.pontos.length})`}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {resumo.pontos.map((p) => {
                      const expandido = pontoAberto === p.codigo;
                      return (
                        <li key={p.codigo} className="rounded-[18px] border border-[#183341]/70 bg-[#071A28]/70 px-3.5 py-3">
                          <button
                            type="button"
                            onClick={() => setAberto(expandido ? "" : p.codigo)}
                            aria-expanded={expandido}
                            disabled={!p.viagens}
                            className="flex w-full items-center justify-between gap-3 text-left disabled:cursor-default"
                          >
                            <span className="min-w-0">
                              <span className="flex items-baseline gap-2">
                                <span className="tabular font-display text-[18px] leading-tight font-extrabold text-ciano">{p.codigo}</span>
                                <span className="text-[13.5px] font-semibold text-gelo/85">{p.viagens ? textoDeViagens(p.viagens.length).toLowerCase() : "sem leitura nesta semana"}</span>
                              </span>
                              {p.conta && p.viagens && p.viagens.length > 0 && (
                                <span className="tabular mt-0.5 block text-[13px] text-gelo/80">
                                  Bruto <span className="font-bold text-white">{brl(p.conta.bruto)}</span> · Comissão <span className="font-bold text-ouro">{brl(p.conta.comissao)}</span>
                                </span>
                              )}
                            </span>
                            {p.viagens && <ChevronDown size={20} className={`shrink-0 text-gelo/70 transition-transform ${expandido ? "rotate-180" : ""}`} />}
                          </button>
                          {p.erro && (
                            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug text-ambar [overflow-wrap:anywhere]">
                              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                              <span>
                                {p.viagens && p.lidoEm ? `Leitura de ${horaDaLeitura(p.lidoEm, agora)}. ` : ""}A última tentativa não veio: {p.erro}.
                              </span>
                            </p>
                          )}
                          {expandido && p.viagens && <ViagensDoPonto p={p} />}
                        </li>
                      );
                    })}
                  </ul>
                </Bloco>
              )}

              {/* quando a leitura não veio: o que a tela do portal mostrou (sem peso nem valor), para mandar ao suporte */}
              {resumo.diagnostico.length > 0 && (Boolean(resumo.erro) || resumo.pontos.some((x) => x.erro)) && (
                <details className="rounded-[18px] border border-[#183341]/70 bg-[#071A28]/60 px-4 py-3 text-[12.5px] leading-snug text-gelo/75" data-ticket="diagnostico">
                  <summary className="cursor-pointer font-display text-[13.5px] font-bold text-gelo/90">Detalhes da última tentativa (para o suporte)</summary>
                  <p className="mt-2 text-gelo/60">O que a tela do portal mostrou. Os números aparecem trocados por 9 — não há peso nem valor aqui.</p>
                  <ul className="mt-2 space-y-1.5">
                    {resumo.diagnostico.map((linha, i) => (
                      <li key={i} className="[overflow-wrap:anywhere]">
                        {linha}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* como funciona */}
              <section className="rounded-[20px] border border-[#183341]/60 bg-[#071A28]/60 px-4 py-3.5 text-[13px] leading-relaxed text-gelo/75">
                <p>
                  As viagens vêm da aba <strong className="text-gelo/90">Ticket</strong> do Portal do Motorista (2ª via), lidas com a sua conta. A conta é a mesma do
                  “Cálculo de Frete”: Quant × Valor de cada viagem; a comissão é a sua porcentagem do valor bruto.
                </p>
                <p className="mt-2">É uma conferência — o que vale é o ticket da Copadubo. Só você vê estes números.</p>
                {resumo.ligado && (
                  <button
                    type="button"
                    onClick={() => void desligar()}
                    onBlur={() => setConfirmando(false)}
                    disabled={ocupado !== null}
                    className={`mt-3 rounded-full border px-4 py-2 font-display text-[13.5px] font-bold disabled:opacity-50 ${
                      confirmando ? "border-ambar text-ambar" : "border-[#183341] text-gelo/80 hover:border-ambar/60"
                    }`}
                  >
                    {ocupado === "desligar" ? "Desligando…" : confirmando ? "Toque de novo para desligar e apagar" : "Desligar o Saldo de Ganhos"}
                  </button>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
