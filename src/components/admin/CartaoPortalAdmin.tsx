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
 * e `senhaFinal4`. A leitura sob demanda ("Ler agora") faz um login novo e
 * passa pela auditoria; "Remover acesso" apaga a senha do banco na hora.
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
  diagnostico: string[];
};

const ROTULO_MODO: Record<ModoSaida, string> = {
  desligado: "Desligado (nada acontece)",
  somente_admin: "Só no painel (teste)",
  motoristas: "Ligado para os motoristas",
};

type Painel = {
  total: number;
  ativos: number;
  lidos24h: number;
  falhas: number;
  atualizadoEm: string | null;
  motoristas: MotoristaPortal[];
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
  const [cenario, setCenario] = useState<"atendimento" | "dispensa">("atendimento");
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
        ? "Ligado: quando o ponto sair, o motorista recebe a mensagem com o trabalho (ou a dispensa)."
        : novo === "somente_admin"
          ? "Modo de teste: o app lê o portal e mostra aqui, mas nada vai para o celular."
          : "Desligado: o app não lê o portal na saída do ponto.",
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
      destino: "nenhum",
      diagnostico: [`Simulação com a tela de exemplo (${d.exemplo}). Nada foi enviado.`],
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
    setAviso("Leitura real feita no portal (nada é enviado no modo de teste).");
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
        setAviso(
          d?.resultado?.loginRecusado
            ? "O portal recusou o CPF/senha cadastrados."
            : d?.resultado?.rodou
              ? d?.resultado?.ok
                ? `Leitura feita: ${d.resultado.linhas} linha(s).`
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
              Reler o portal de cada motorista é um login novo — o servidor faz isso a cada 5 min.
            </span>
          </div>

          {aviso && (
            <p role="status" className="mt-2 rounded-[14px] border border-ciano/40 px-3 py-2 text-[12.5px] text-ciano">
              {aviso}
            </p>
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
              Quando o ponto monitorado sai da tela, o app entra no portal com o CPF/senha do
              motorista, lê a <b>Tela de Ativos</b> e o <b>Status do Ponto</b> e manda a mensagem:
              para qual trabalho saiu (tipo, livro, posição) — ou que o ponto foi para a
              <b> dispensa</b> (com o motivo). Aqui você testa antes de ligar para os motoristas.
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
                ? "Nada é lido nem enviado na saída do ponto."
                : modo === "somente_admin"
                  ? "O app lê o portal e registra aqui; NADA chega no celular do motorista."
                  : "Ligado de verdade: o motorista recebe a mensagem (Web Push) na saída e na dispensa."}
            </p>

            <label className="mt-2 block">
              <span className="mb-1 block text-[11.5px] font-semibold text-gelo/60">
                Telas do portal (uma por vírgula · vazio = a tela inicial)
              </span>
              <input
                value={caminhos}
                onChange={(e) => setCaminhos(e.target.value)}
                onBlur={() => void salvarModo(modo)}
                placeholder="moto/fila.php"
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
                  onChange={(e) => setCenario(e.target.value as "atendimento" | "dispensa")}
                  className="w-full rounded-[12px] border border-[#183341]/70 bg-[#071A28] px-3 py-2 text-[12.5px] text-white outline-none focus:border-ouro/60"
                >
                  <option value="atendimento">Saiu para o trabalho</option>
                  <option value="dispensa">Foi para a dispensa</option>
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
                  {resultado.evento?.titulo ?? "Sem leitura"}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-gelo/85">
                  {resultado.evento?.mensagem ?? resultado.motivo ?? "—"}
                </p>
                <p className="mt-1 text-[11.5px] text-gelo/50">
                  {resultado.evento?.saiu
                    ? resultado.evento.dispensa
                      ? "Situação: DISPENSA"
                      : "Situação: saiu para o trabalho"
                    : "Situação: não saiu (aviso de saída não seria enviado)"}
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
                      <p className="mt-0.5 text-[12px] leading-snug text-gelo/80">{e.mensagem}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <p className="mt-3 text-[11.5px] leading-snug text-gelo/45">
            A senha do portal nunca é exibida (só os 4 últimos caracteres) e não é registrada em
            log, auditoria ou aviso. Cada leitura faz um login novo e a página é transformada em
            seções — se a Copadubo mudar o layout, o leitor continua funcionando sem código novo.
          </p>
        </div>
      )}
    </section>
  );
}
