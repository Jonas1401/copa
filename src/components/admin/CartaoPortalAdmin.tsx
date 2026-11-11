"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";

/**
 * PORTAL DO MOTORISTA (portal.copadubo.com.br) — exclusivo do ADMINISTRADOR.
 *
 * O motorista cadastra o próprio CPF/senha no app (menu ⋮ → Portal do
 * motorista). Aqui o administrador vê, por motorista:
 *   - se o acesso existe e está ativo (CPF mascarado, 4 últimos da senha);
 *   - o resultado da última leitura: deu certo? quantas linhas? quando?
 *   - o DIAGNÓSTICO por tentativa (login recusado, captcha, portal fora…);
 *   - as linhas que o leitor marcou como interessantes e a página inteira.
 *
 * O CPF completo e a senha NÃO chegam até aqui — a API só manda `cpfMascarado`
 * e `senhaFinal4`. A leitura sob demanda ("Ler agora") usa a sessão guardada
 * do motorista (o login só se repete quando o portal pede) e passa pela
 * auditoria; "Remover acesso" apaga a senha do banco na hora.
 *
 * Com o Status do portal como fonte do aviso de saída (o padrão), o cartão
 * mostra também a situação guardada de cada ponto (ATIVO / ESCALADO / EM
 * DISPENSA) — é a troca dela que gera o aviso.
 */

type Ultima = {
  em: string;
  ok: boolean;
  loginRecusado: boolean;
  captcha: boolean;
  linhas: number;
  titulo: string | null;
  ms: number;
  sinais: string[];
  diagnostico: string[];
  secoes: { titulo: string; linhas: string[] }[];
};

type MotoristaPortal = {
  motoristaId: number;
  nome: string;
  cpfMascarado: string;
  senhaFinal4: string;
  ativo: boolean;
  desde: string | null;
  ultima: Ultima | null;
};

/** Avisos de saída/dispensa registrados (o teste do administrador). */
type EventoSaida = {
  id: number;
  motoristaId: number;
  tipo: string;
  codigo: string | null;
  turno: string | null;
  motivo: string | null;
  tipoTrabalho: string | null;
  livro: string | null;
  destino: "teste" | "motorista" | "nenhum";
  titulo: string;
  mensagem: string;
  diagnostico: string[];
  modo: string;
  quando: string;
};

type ModoSaida = "desligado" | "somente_admin" | "motoristas";

type ResultadoSaida = {
  rodou: boolean;
  motivo?: string;
  evento: {
    saiu: boolean;
    dispensa: boolean;
    codigo: string | null;
    tipoTrabalho: string | null;
    livro: string | null;
    posicao: number | null;
    titulo: string;
    mensagem: string;
  } | null;
  destino: "teste" | "motorista" | "nenhum";
  push?: { enviadas: number; erro?: string };
  /** Texto final do aviso (título + corpo), como chega no celular — só na simulação. */
  aviso?: { titulo: string; mensagem: string } | null;
  diagnostico: string[];
};

type CenarioSaida = "escalado" | "dispensa" | "ativo" | "ativo_fora";

const ROTULO_MODO: Record<ModoSaida, string> = {
  desligado: "Desligado (nada acontece)",
  somente_admin: "Só no painel (teste)",
  motoristas: "Ligado para os motoristas",
};

/** Situação guardada de um ponto, como o Status do portal mostrou. */
type SituacaoPainel = {
  motoristaId: number;
  /** Código como o portal escreve (A032). */
  codigo: string;
  turno: string;
  lidoEm: string;
  mudouEm: string;
  /** Lida há pouco (uma leitura antiga não afirma nada sobre agora). */
  recente: boolean;
};

type Painel = {
  total: number;
  ativos: number;
  lidos24h: number;
  falhas: number;
  atualizadoEm: string | null;
  motoristas: MotoristaPortal[];
  /** Quem decide a saída do ponto e o que o monitor do Status tem guardado. */
  monitor?: { fonte: "portal" | "quadro"; intervaloMin: number; situacoes: SituacaoPainel[]; fila?: FilaPainel };
};

/** A fila geral do app: o que a aba “Fila” do portal trouxe (ou por que não veio). */
type FilaPainel = {
  fonte: "portal" | "quadro";
  livros: {
    livro: string;
    lidoEm: string | null;
    recente: boolean;
    truck: { naFila: number; ultimo: number } | null;
    carreta: { naFila: number; ultimo: number } | null;
    erro: string | null;
    tentativaEm: string | null;
    motoristaId: number | null;
    diagnostico: string[];
  }[];
};

const CHAVE_TOKEN = "copalinks-admin-sessao";

function cabecalhoAdmin(): Record<string, string> {
  try {
    const t = sessionStorage.getItem(CHAVE_TOKEN);
    return t ? { authorization: `Bearer ${t}`, "content-type": "application/json" } : { "content-type": "application/json" };
  } catch {
    return { "content-type": "application/json" };
  }
}

const horaMin = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : "—";

const estadoDe = (m: MotoristaPortal) => {
  if (!m.ativo) return { texto: "pausado", cor: "text-gelo/60" };
  if (!m.ultima) return { texto: "aguardando 1ª leitura", cor: "text-ouro" };
  if (m.ultima.loginRecusado) return { texto: "senha recusada", cor: "text-red-300" };
  if (m.ultima.captcha) return { texto: "captcha", cor: "text-ouro" };
  if (!m.ultima.ok) return { texto: "sem conteúdo", cor: "text-red-300" };
  return { texto: `lido · ${m.ultima.linhas} linha(s)`, cor: "text-ciano" };
};

export default function CartaoPortalAdmin() {
  const [aberto, setAberto] = useState(false);
  const [p, setP] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const [verPagina, setVerPagina] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);

  // ------------------------------------------------ saída do ponto (teste)
  const [modo, setModo] = useState<ModoSaida>("desligado");
  const [caminhos, setCaminhos] = useState("");
  const [eventos, setEventos] = useState<EventoSaida[]>([]);
  const [resultado, setResultado] = useState<ResultadoSaida | null>(null);
  const [motoristaTeste, setMotoristaTeste] = useState<number | "">("");
  const [cenario, setCenario] = useState<CenarioSaida>("escalado");
  const [verDetalhe, setVerDetalhe] = useState<number | null>(null);
  const [rodandoSaida, setRodandoSaida] = useState<string | null>(null);

  const carregarSaida = useCallback(async () => {
    const r = await fetch("/api/admin/portal/saida", { cache: "no-store", headers: cabecalhoAdmin() });
    if (!r.ok) return;
    const d = await r.json().catch(() => ({}));
    if (d?.modo) setModo(d.modo as ModoSaida);
    if (Array.isArray(d?.caminhos)) setCaminhos(d.caminhos.join(", "));
    if (Array.isArray(d?.eventos)) setEventos(d.eventos as EventoSaida[]);
  }, []);

  async function salvarModo(novo: ModoSaida) {
    setModo(novo);
    setRodandoSaida("modo");
    const r = await fetch("/api/admin/portal/saida", {
      method: "POST",
      cache: "no-store",
      headers: cabecalhoAdmin(),
      body: JSON.stringify({
        acao: "modo",
        modo: novo,
        caminhos: caminhos.split(/[,;]+/).map((c) => c.trim()).filter(Boolean),
      }),
    });
    setRodandoSaida(null);
    if (!r.ok) {
      setAviso("Não foi possível mudar o modo agora.");
      return;
    }
    setAviso(
      novo === "motoristas"
        ? "Teste manual habilitado para enviar um aviso adicional ao motorista."
        : novo === "somente_admin"
          ? "Teste manual: o resultado aparece aqui, sem enviar aviso extra."
          : "Teste manual desligado; a consulta automática continua ativa.",
    );
    await carregarSaida();
  }

  async function simular() {
    setRodandoSaida("simular");
    setResultado(null);
    const r = await fetch("/api/admin/portal/saida", {
      method: "POST",
      cache: "no-store",
      headers: cabecalhoAdmin(),
      body: JSON.stringify({ acao: "simular", cenario }),
    });
    const d = await r.json().catch(() => ({}));
    setRodandoSaida(null);
    if (!r.ok) {
      setAviso(d?.erro ?? "Não foi possível simular.");
      return;
    }
    setResultado({
      rodou: true,
      evento: d.evento,
      aviso: d.aviso ?? null,
      destino: "nenhum",
      diagnostico: [
        `Simulação com a tela de exemplo (${d.exemplo}). Nada foi enviado.`,
        ...(d.decisao ? [`Decisão: ${d.decisao}`] : []),
      ],
    });
  }

  async function testarNoPortal() {
    if (!motoristaTeste) {
      setAviso("Escolha o motorista que tem CPF/senha cadastrados.");
      return;
    }
    setRodandoSaida("teste");
    setResultado(null);
    const r = await fetch("/api/admin/portal/saida", {
      method: "POST",
      cache: "no-store",
      headers: cabecalhoAdmin(),
      body: JSON.stringify({ acao: "teste", motoristaId: motoristaTeste }),
    });
    const d = await r.json().catch(() => ({}));
    setRodandoSaida(null);
    if (!r.ok) {
      setAviso(d?.erro ?? "Não foi possível testar agora.");
      return;
    }
    setResultado(d.resultado as ResultadoSaida);
    if (d.eventos) setEventos(d.eventos as EventoSaida[]);
    setAviso(
      (d.resultado as ResultadoSaida)?.rodou
        ? "Leitura real feita no portal (nada é enviado no modo de teste)."
        : "A leitura não rodou: esse motorista está sem CPF/senha ou com o acesso pausado.",
    );
  }

  const buscar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/admin/portal", { cache: "no-store", headers: cabecalhoAdmin() });
      if (r.ok) setP((await r.json()) as Painel);
      else if (r.status === 401) setAviso("Sessão expirada. Entre novamente no painel.");
    } catch {
      setAviso("Não foi possível carregar o monitoramento do portal agora.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => {
      if (!p) void buscar();
      void carregarSaida();
    }, 0);
    return () => clearTimeout(t);
  }, [aberto, p, buscar, carregarSaida]);

  async function acao(motoristaId: number, o: "ler" | "remover") {
    setOcupado(motoristaId);
    setAviso("");
    try {
      const r = await fetch("/api/admin/portal", {
        method: "POST",
        cache: "no-store",
        headers: cabecalhoAdmin(),
        body: JSON.stringify({ motoristaId, acao: o }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setAviso("Sessão expirada. Entre novamente no painel.");
        return;
      }
      if (!r.ok) {
        setAviso(d?.erro ?? "Não foi possível concluir a ação.");
        return;
      }
      if (d?.motoristas) setP(d as Painel);
      if (o === "ler") {
        // Situação de cada ponto nesta leitura (quando o Status é a fonte do aviso).
        const lidas: string[] = Array.isArray(d?.resultado?.situacoes)
          ? (d.resultado.situacoes as { codigo?: string; turno?: string | null }[])
              .filter((x) => x?.codigo && x?.turno)
              .map((x) => `${x.codigo} ${x.turno}`)
          : [];
        setAviso(
          d?.resultado?.loginRecusado
            ? "O portal recusou o CPF/senha cadastrados."
            : d?.resultado?.rodou
              ? d?.resultado?.ok
                ? lidas.length
                  ? `Status lido: ${lidas.join(" · ")}.`
                  : `Leitura feita: ${d.resultado.linhas} linha(s).`
                : d?.resultado?.entrou
                  ? "O portal abriu, mas a tela de Status não mostrou a situação do ponto cadastrado no app."
                  : "A leitura não trouxe conteúdo."
              : "Esse motorista não tem acesso cadastrado.",
        );
      } else {
        setAviso("Acesso removido: o CPF/senha desse motorista saíram do banco.");
      }
    } catch {
      setAviso("Falha de rede ao falar com o servidor.");
    } finally {
      setOcupado(null);
      setConfirmando(null);
    }
  }

  const lista = p?.motoristas ?? [];
  // Quem decide a saída do ponto: o Status do portal (padrão) ou o quadro.
  const peloStatus = p?.monitor?.fonte !== "quadro";
  const cadaMin =
    p?.monitor?.intervaloMin && p.monitor.intervaloMin > 1 ? `a cada ${p.monitor.intervaloMin} min` : "de minuto em minuto";
  const situacoesDe = (motoristaId: number) => (p?.monitor?.situacoes ?? []).filter((x) => x.motoristaId === motoristaId);

  return (
    <section className="mt-4 rounded-[22px] border border-[#183341]/60 bg-[#071A28]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#00B8BC] uppercase">
            <KeyRound size={22} /> Portal do motorista
          </h2>
          <p className="mt-0.5 text-[12.5px] text-gelo/60">
            {p
              ? `${p.total} motorista(s) cadastraram CPF/senha · ${p.lidos24h} lido(s) nas últimas 24 h${
                  p.falhas ? ` · ${p.falhas} com falha` : ""
                }`
              : "Leitura do portal.copadubo.com.br com o CPF/senha de cada motorista"}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gelo/70">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-[#183341]/35 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void buscar()}
              disabled={carregando}
              className="flex items-center gap-2 rounded-full border border-ciano/60 bg-[#071A28] px-4 py-2 font-display text-[13px] font-bold text-ciano uppercase disabled:opacity-50"
            >
              {carregando ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Atualizar
            </button>
            <span className="text-[12px] text-gelo/55">
              {peloStatus
                ? `O servidor olha o Status de cada motorista ${cadaMin}, com a sessão que fica guardada: o login só se repete quando o portal pede.`
                : "Cada leitura é um login novo na conta do motorista: o servidor só entra quando um ponto dele sai do quadro (e, em dispensa, a cada 10 min)."}
            </span>
          </div>

          {aviso && (
            <p role="status" className="mt-2 rounded-[14px] border border-ciano/40 px-3 py-2 text-[12.5px] text-ciano">
              {aviso}
            </p>
          )}

          {p?.monitor?.fila?.fonte === "portal" && (
            <div className="mt-3 rounded-[14px] border border-[#183341]/60 bg-[#000D16]/40 px-3 py-2.5">
              <p className="font-display text-[12.5px] font-bold tracking-[0.04em] text-gelo/85 uppercase">
                Fila do app · aba “Fila” do portal
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-gelo/55">
                O quadro público foi desligado pela Copadubo. A fila (card principal, posição e avisos de vez) é lida
                na aba “Fila”, com a sessão de um dos motoristas acima, na carona da leitura do Status.
              </p>
              {p.monitor.fila.livros.map((f) => {
                const cod = (n: number) => (n ? `${f.livro}${String(n).padStart(3, "0")}` : "—");
                return (
                  <div key={f.livro} className="mt-2 text-[12.5px] leading-snug">
                    <p className={f.recente && !f.erro ? "text-verde" : "text-ambar"}>
                      <b>Livro {f.livro}</b>{" "}
                      {f.truck && f.carreta
                        ? `· Truck ${f.truck.naFila} na fila (último ${cod(f.truck.ultimo)}) · Carreta ${f.carreta.naFila} na fila (último ${cod(f.carreta.ultimo)})`
                        : "· ainda sem leitura"}
                    </p>
                    <p className="text-[11.5px] text-gelo/55">
                      {f.lidoEm ? `Lida em ${horaMin(f.lidoEm)}${f.recente ? "" : " — leitura velha: o app mostra OFFLINE"}` : "Nunca lida."}
                      {f.motoristaId ? ` · conta do motorista nº ${f.motoristaId}` : ""}
                    </p>
                    {f.erro && (
                      <p className="mt-0.5 text-[11.5px] text-ambar">
                        Última tentativa{f.tentativaEm ? ` (${horaMin(f.tentativaEm)})` : ""} não serviu: {f.erro}
                      </p>
                    )}
                    {f.erro && f.diagnostico.length > 0 && (
                      <p className="mt-0.5 text-[11px] leading-snug text-gelo/45">{f.diagnostico.join(" · ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!lista.length && (
            <p className="mt-3 text-[13.5px] leading-snug text-gelo/70">
              Nenhum motorista cadastrou o portal ainda. No aplicativo, o motorista abre
              <b> menu ⋮ → Portal do motorista</b> e digita o próprio CPF e a senha; a partir daí
              a página dele é lida no servidor e aparece aqui (com CPF mascarado e sem a senha).
            </p>
          )}

          <div className="mt-3 space-y-2">
            {lista.map((m) => {
              const est = estadoDe(m);
              const pagina = verPagina === m.motoristaId;
              return (
                <div key={m.motoristaId} className="rounded-[16px] border border-[#183341]/55 bg-[#071A28]/70 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-display text-[14px] font-bold text-white">{m.nome}</span>
                    <span className="text-[12px] text-gelo/60">#{m.motoristaId}</span>
                    <span className="text-[12px] text-gelo/70">
                      CPF {m.cpfMascarado} · senha ••••{m.senhaFinal4}
                    </span>
                    <span className={`text-[12px] font-semibold ${est.cor}`}>{est.texto}</span>
                    <span className="ml-auto text-[11.5px] text-gelo/50">
                      {m.ultima ? horaMin(m.ultima.em) : `cadastrado em ${horaMin(m.desde)}`}
                    </span>
                  </div>

                  {peloStatus && m.ativo ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {situacoesDe(m.motoristaId).length ? (
                        situacoesDe(m.motoristaId).map((x) => (
                          <span
                            key={x.codigo}
                            title={`Lido em ${horaMin(x.lidoEm)} · nesta situação desde ${horaMin(x.mudouEm)}`}
                            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${
                              !x.recente
                                ? "border-[#183341]/70 text-gelo/50"
                                : x.turno === "EM DISPENSA"
                                  ? "border-red-400/50 text-red-200"
                                  : x.turno === "ATIVO"
                                    ? "border-ciano/45 text-ciano"
                                    : "border-ouro/50 text-ouro"
                            }`}
                          >
                            {x.codigo} · {x.turno}
                            {x.recente ? "" : " (leitura antiga)"}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11.5px] text-gelo/50">
                          Situação do ponto ainda não lida no Status — sem ela não há aviso de saída.
                        </span>
                      )}
                    </div>
                  ) : null}

                  {m.ultima?.sinais?.length ? (
                    <ul className="mt-2 space-y-0.5">
                      {m.ultima.sinais.slice(0, 5).map((s, i) => (
                        <li key={i} className="flex gap-1.5 text-[12.5px] text-gelo/80">
                          <span className="text-ciano">•</span>
                          <span className="min-w-0">{s}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {m.ultima?.diagnostico?.length ? (
                    <p className="mt-1.5 text-[11.5px] leading-snug text-gelo/50">
                      {m.ultima.diagnostico.join(" · ")}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void acao(m.motoristaId, "ler")}
                      disabled={ocupado === m.motoristaId}
                      className="flex items-center gap-1.5 rounded-full border border-[#183341]/80 px-3 py-1.5 text-[12px] font-semibold text-gelo disabled:opacity-50"
                    >
                      {ocupado === m.motoristaId ? (
                        <LoaderCircle size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      Ler agora
                    </button>
                    {m.ultima?.secoes?.length ? (
                      <button
                        type="button"
                        onClick={() => setVerPagina(pagina ? null : m.motoristaId)}
                        className="rounded-full border border-[#183341]/80 px-3 py-1.5 text-[12px] font-semibold text-gelo"
                      >
                        {pagina ? "Ocultar página" : "Ver o que foi lido"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmando !== m.motoristaId) {
                          setConfirmando(m.motoristaId);
                          return;
                        }
                        void acao(m.motoristaId, "remover");
                      }}
                      disabled={ocupado === m.motoristaId}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ${
                        confirmando === m.motoristaId
                          ? "border-red-400/60 text-red-200"
                          : "border-[#183341]/80 text-gelo/80"
                      }`}
                    >
                      <Trash2 size={13} />
                      {confirmando === m.motoristaId ? "Confirmar remoção" : "Remover acesso"}
                    </button>
                  </div>

                  {pagina && m.ultima ? (
                    <div className="mt-2 max-h-[320px] space-y-2 overflow-y-auto rounded-[14px] border border-[#183341]/50 bg-[#000D16]/60 p-2.5">
                      {m.ultima.secoes.map((s, i) => (
                        <div key={i}>
                          <p className="micro text-ciano/80">{s.titulo}</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {s.linhas.slice(0, 40).map((l, j) => (
                              <li key={j} className="text-[12px] leading-snug text-gelo/75">
                                {l}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* ------------------------------- saída do ponto (teste) */}
          <div className="mt-4 rounded-[16px] border border-ouro/30 bg-[#071A28]/80 p-3">
            <h3 className="flex items-center gap-2 font-display text-[14px] font-bold tracking-[0.03em] text-ouro uppercase">
              <FlaskConical size={16} /> Saída do ponto (teste)
            </h3>
            <p className="mt-1 text-[12.5px] leading-snug text-gelo/70">
              {peloStatus ? (
                <>
                  Quem decide que o ponto saiu é o <b>Status do Ponto</b> no portal, olhado {cadaMin} na
                  conta de cada motorista. A troca de situação gera um aviso só: <b>ESCALADO</b> (com
                  as linhas da escala que o portal mostrar), <b>EM DISPENSA</b> (com o motivo) ou de
                  volta a <b>ATIVO</b>. O quadro só mostra a fila e avisa que a vez está chegando;
                  motorista sem CPF/senha cadastrados não recebe aviso de saída. As opções abaixo
                  controlam apenas os testes manuais.
                </>
              ) : (
                <>
                  Quando o ponto monitorado sai do quadro, o app entra no portal com o CPF/senha do
                  motorista, lê o <b>Status do Ponto</b> e manda um aviso só: <b>ESCALADO</b> (com as
                  linhas da escala que o portal mostrar), <b>EM DISPENSA</b> (com o motivo) ou, se o
                  portal ainda disser <b>ATIVO</b>, o aviso do quadro dizendo isso. A consulta automática
                  faz parte do aviso normal; as opções abaixo controlam apenas os testes manuais.
                </>
              )}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(ROTULO_MODO) as ModoSaida[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void salvarModo(m)}
                  disabled={rodandoSaida === "modo"}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ${
                    modo === m ? "border-ouro bg-ouro/15 text-ouro" : "border-[#183341]/80 text-gelo/80"
                  }`}
                >
                  {ROTULO_MODO[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-gelo/55">
              {modo === "desligado"
                ? "Teste manual desligado. O aviso normal da fila continua funcionando."
                : modo === "somente_admin"
                  ? "Teste manual: a leitura é registrada aqui, sem enviar aviso extra."
                  : "O teste manual pode enviar um aviso adicional ao motorista."}
            </p>

            <label className="mt-2 block">
              <span className="mb-1 block text-[11.5px] font-semibold text-gelo/60">
                Telas extras do portal (opcional · uma por vírgula). Vazio = o leitor abre o
                Status e as abas que o próprio menu do portal informa.
              </span>
              <input
                value={caminhos}
                onChange={(e) => setCaminhos(e.target.value)}
                onBlur={() => void salvarModo(modo)}
                placeholder="deixe vazio"
                className="w-full rounded-[12px] border border-[#183341]/70 bg-[#071A28] px-3 py-2 text-[12.5px] text-white outline-none focus:border-ouro/60"
              />
            </label>

            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="min-w-[160px] flex-1">
                <span className="mb-1 block text-[11.5px] font-semibold text-gelo/60">Motorista (teste real)</span>
                <select
                  value={motoristaTeste}
                  onChange={(e) => setMotoristaTeste(e.target.value ? Number(e.target.value) : "")}
                  className="w-full rounded-[12px] border border-[#183341]/70 bg-[#071A28] px-3 py-2 text-[12.5px] text-white outline-none focus:border-ouro/60"
                >
                  <option value="">Escolha…</option>
                  {lista.map((m) => (
                    <option key={m.motoristaId} value={m.motoristaId}>
                      {m.nome} (CPF {m.cpfMascarado})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void testarNoPortal()}
                disabled={rodandoSaida === "teste"}
                className="flex items-center gap-1.5 rounded-full border border-ciano/60 px-3 py-2 text-[12px] font-semibold text-ciano disabled:opacity-50"
              >
                {rodandoSaida === "teste" ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}
                Ler o portal agora
              </button>
              <label className="min-w-[130px]">
                <span className="mb-1 block text-[11.5px] font-semibold text-gelo/60">Simular</span>
                <select
                  value={cenario}
                  onChange={(e) => setCenario(e.target.value as CenarioSaida)}
                  className="w-full rounded-[12px] border border-[#183341]/70 bg-[#071A28] px-3 py-2 text-[12.5px] text-white outline-none focus:border-ouro/60"
                >
                  <option value="escalado">Saiu para o trabalho (ESCALADO)</option>
                  <option value="dispensa">Foi para a dispensa</option>
                  {/* Avisos que só existem quando é o QUADRO que decide a saída. */}
                  {!peloStatus && <option value="ativo">Portal ainda ATIVO · é o Último Escalado</option>}
                  {!peloStatus && <option value="ativo_fora">Portal continua ATIVO · sumiu do quadro</option>}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void simular()}
                disabled={rodandoSaida === "simular"}
                className="flex items-center gap-1.5 rounded-full border border-[#183341]/80 px-3 py-2 text-[12px] font-semibold text-gelo disabled:opacity-50"
              >
                {rodandoSaida === "simular" ? <LoaderCircle size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                Simular mensagem
              </button>
            </div>

            {resultado && (
              <div className="mt-2 rounded-[14px] border border-[#183341]/60 bg-[#000D16]/60 p-2.5">
                <p className="text-[12px] font-semibold text-gelo/60">Mensagem que o motorista recebe</p>
                <p className="mt-0.5 font-display text-[13.5px] font-bold text-white">
                  {resultado.aviso?.titulo ?? resultado.evento?.titulo ?? "Sem leitura"}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug whitespace-pre-line text-gelo/85">
                  {resultado.aviso?.mensagem ?? resultado.evento?.mensagem ?? resultado.motivo ?? "—"}
                </p>
                <p className="mt-1 text-[11.5px] text-gelo/50">
                  {resultado.evento?.saiu
                    ? resultado.evento.dispensa
                      ? "Situação: DISPENSA"
                      : "Situação: saiu para o trabalho"
                    : peloStatus
                      ? "Situação no portal: não consta como saído (sem aviso de saída)"
                      : "Situação no portal: não consta como saído (quando o número sai do quadro, vai o aviso do quadro)"}
                  {resultado.evento?.tipoTrabalho ? ` · trabalho: ${resultado.evento.tipoTrabalho}` : ""}
                  {resultado.evento?.livro ? ` · livro ${resultado.evento.livro}` : ""}
                  {resultado.evento?.posicao ? ` · posição ${resultado.evento.posicao}` : ""}
                  {" · destino: "}
                  {resultado.destino === "motorista" ? "celular do motorista" : resultado.destino === "teste" ? "teste" : "nenhum"}
                  {typeof resultado.push?.enviadas === "number" ? ` (${resultado.push.enviadas} aparelho(s))` : ""}
                </p>
                {resultado.diagnostico.length ? (
                  <p className="mt-1 text-[11px] leading-snug text-gelo/45">{resultado.diagnostico.join(" · ")}</p>
                ) : null}
              </div>
            )}

            {eventos.length ? (
              <div className="mt-2">
                <p className="micro text-gelo/50">Últimos avisos registrados</p>
                <ul className="mt-1 space-y-1">
                  {eventos.slice(0, 6).map((e) => (
                    <li key={e.id} className="rounded-[12px] border border-[#183341]/50 px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-gelo/75">
                        <span className="font-semibold text-white">{e.titulo}</span>
                        <span className="text-gelo/50">{horaMin(e.quando)}</span>
                        <span className="text-gelo/50">#{e.motoristaId}</span>
                        <span
                          className={
                            e.destino === "motorista" ? "text-ciano" : e.destino === "teste" ? "text-ouro" : "text-gelo/50"
                          }
                        >
                          {e.destino === "motorista" ? "enviado ao motorista" : e.destino === "teste" ? "só teste" : "não enviado"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug whitespace-pre-line text-gelo/80">{e.mensagem}</p>
                      {e.diagnostico?.length ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setVerDetalhe(verDetalhe === e.id ? null : e.id)}
                            className="mt-1 text-[11px] font-semibold text-ciano/80 underline-offset-2 hover:underline"
                          >
                            {verDetalhe === e.id ? "Ocultar o que o leitor viu" : "Ver o que o leitor viu no portal"}
                          </button>
                          {verDetalhe === e.id ? (
                            <ul className="mt-1 space-y-0.5 rounded-[10px] bg-[#000D16]/60 p-2">
                              {e.diagnostico.map((linha, i) => (
                                <li key={i} className="text-[11px] leading-snug text-gelo/60">
                                  {linha}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <p className="mt-3 text-[11.5px] leading-snug text-gelo/45">
            A senha do portal nunca é exibida (só os 4 últimos caracteres) e não é registrada em
            log, auditoria ou aviso. {peloStatus ? "A sessão de cada motorista fica guardada cifrada, como a senha," : "Cada leitura faz um login novo"} e a página é transformada em
            seções — se a Copadubo mudar o layout, o leitor continua funcionando sem código novo.
          </p>
        </div>
      )}
    </section>
  );
}
