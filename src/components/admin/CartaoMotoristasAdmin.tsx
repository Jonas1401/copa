"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, ChevronDown, ChevronUp, Megaphone, RefreshCw, Search, Trash2, Users } from "lucide-react";
import type { PontoDTO } from "@/lib/estado";

type MotoristaAdmin = {
  id: number;
  nome: string;
  criadoEm: string;
  avisos: number;
  pontos: PontoDTO[];
  alerta?: { criadoEm: string; resolvidoEm: string | null } | null;
};
type Resposta = {
  motoristas?: MotoristaAdmin[];
  semDono?: PontoDTO[];
  ultimaLeitura?: string | null;
  erro?: string;
};
type Api = <T>(url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; dados: T }>;

const FUSO = "America/Sao_Paulo";
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

const COR_STATUS: Record<string, string> = {
  AGUARDANDO: "border-verde/45 bg-verde/10 text-verde",
  "NA VEZ": "border-ambar/60 bg-ambar/15 text-ambar",
  SAIU: "border-gelo/25 bg-white/5 text-gelo/70",
};

function Ponto({ p }: { p: PontoDTO }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] ${COR_STATUS[p.status] ?? COR_STATUS.SAIU}`}
    >
      <b className="font-bold">
        {p.rotulo} {p.codigo}
      </b>
      <span className="opacity-85">· {p.detalhe}</span>
    </span>
  );
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || "motorista";
const mensagemPadrao = (nome: string) =>
  `Olá, ${primeiroNome(nome)}! Suas notificações do CopaLinks estão desativadas. Ative para receber o aviso quando o seu ponto for chamado.`;

/** Alerta individual: botão, mensagem editável e situação (aguardando / ativou). */
function AlertaMotorista({ m, api, onSessaoExpirada, onMudou }: {
  m: MotoristaAdmin;
  api: Api;
  onSessaoExpirada: (status: number) => boolean | void;
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [retorno, setRetorno] = useState("");
  const pendente = Boolean(m.alerta && !m.alerta.resolvidoEm);

  async function chamar(metodo: "POST" | "DELETE") {
    setOcupado(true); setRetorno("");
    try {
      const r = await api<{ ok?: boolean; erro?: string; pushEnviadas?: number }>(`/api/admin/motoristas/${m.id}/alerta`, {
        method: metodo,
        ...(metodo === "POST" ? { body: JSON.stringify({ mensagem: mensagem.trim() || mensagemPadrao(m.nome) }) } : {}),
      });
      if (r.status === 401) { onSessaoExpirada(401); return; }
      if (!r.ok) { setRetorno(r.dados.erro ?? "Não foi possível enviar."); return; }
      setAberto(false);
      setRetorno(metodo === "POST"
        ? `Alerta enviado. Aparece no app de ${primeiroNome(m.nome)} ao abrir${r.dados.pushEnviadas ? " (e saiu também por notificação)" : ""}.`
        : "Alerta cancelado.");
      onMudou();
    } catch {
      setRetorno("Sem conexão. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-2">
      {m.alerta && (
        <p className={`text-[12.5px] ${pendente ? "text-ambar" : "text-verde"}`}>
          {pendente
            ? `📢 Alerta enviado ${dia(m.alerta.criadoEm)} às ${hora(m.alerta.criadoEm)} · aguardando ativar as notificações`
            : `✔ Ativou as notificações pelo alerta em ${dia(m.alerta.resolvidoEm!)} às ${hora(m.alerta.resolvidoEm!)}`}
        </p>
      )}
      {!aberto ? (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setMensagem(mensagemPadrao(m.nome)); setAberto(true); setRetorno(""); }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold ${
              m.avisos ? "border border-[#2a5bb0]/70 text-gelo/85 hover:border-ciano/60" : "bg-ambar/90 text-[#281e00] hover:bg-ambar"
            }`}
          >
            <Megaphone size={15} /> {pendente ? "Reenviar alerta" : "Enviar alerta"}
          </button>
          {pendente && (
            <button type="button" disabled={ocupado} onClick={() => void chamar("DELETE")}
              className="rounded-full px-3 py-2 text-[13px] text-gelo/60 hover:text-white disabled:opacity-50">
              Cancelar alerta
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-[14px] border border-ambar/40 bg-black/25 p-3">
          <p className="text-[12.5px] text-gelo/70">
            Aparece no app de <b className="text-white">{m.nome}</b> em tela cheia e só fecha quando ele ativar as notificações.
          </p>
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value.slice(0, 400))}
            rows={3}
            aria-label={`Mensagem do alerta para ${m.nome}`}
            className="mt-2 w-full rounded-xl border border-[#2a5bb0]/70 bg-[#06122b] p-2.5 text-[14px] text-white outline-none focus:border-ciano/70"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={ocupado || !mensagem.trim()} onClick={() => void chamar("POST")}
              className="inline-flex items-center gap-1.5 rounded-full bg-ambar px-4 py-2 text-[13px] font-extrabold text-[#281e00] disabled:opacity-50">
              <Megaphone size={15} /> {ocupado ? "Enviando…" : "Enviar alerta"}
            </button>
            <button type="button" onClick={() => setAberto(false)} className="rounded-full px-3 py-2 text-[13px] text-gelo/70 hover:text-white">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {retorno && <p className="mt-1.5 text-[12.5px] text-ciano" role="status">{retorno}</p>}
    </div>
  );
}

/**
 * Painel do administrador → Motoristas: nome e pontos de TODOS os motoristas.
 * (No app, cada motorista vê só os próprios pontos.)
 */
export default function CartaoMotoristasAdmin({
  api,
  onSessaoExpirada,
}: {
  api: Api;
  onSessaoExpirada: (status: number) => boolean | void;
}) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<MotoristaAdmin[] | null>(null);
  const [semDono, setSemDono] = useState<PontoDTO[]>([]);
  const [ultimaLeitura, setUltimaLeitura] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await api<Resposta>("/api/admin/motoristas");
      if (r.status === 401) {
        onSessaoExpirada(401);
        return;
      }
      if (!r.ok || !r.dados.motoristas) {
        setErro(r.dados.erro ?? "Não foi possível carregar os motoristas.");
        return;
      }
      setErro("");
      setLista(r.dados.motoristas);
      setSemDono(r.dados.semDono ?? []);
      setUltimaLeitura(r.dados.ultimaLeitura ?? null);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [api, onSessaoExpirada]);

  // Carrega ao abrir e atualiza as posições a cada 30 s (só com a tela visível).
  useEffect(() => {
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void carregar();
    }, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function excluirMotorista(m: MotoristaAdmin) {
    if (!window.confirm(`Tem certeza que deseja excluir o motorista "${m.nome}" (ID #${m.id})? Esta ação removerá o cadastro e os pontos dele.`)) {
      return;
    }
    try {
      const r = await api<{ sucesso?: boolean; erro?: string }>(`/api/admin/motoristas/${m.id}`, {
        method: "DELETE",
      });
      if (r.status === 401) {
        onSessaoExpirada(401);
        return;
      }
      if (!r.ok) {
        alert(r.dados.erro ?? "Não foi possível excluir o motorista.");
        return;
      }
      await carregar();
    } catch {
      alert("Sem conexão. Tente de novo.");
    }
  }

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!lista || !f) return lista ?? [];
    return lista.filter(
      (m) => m.nome.toLowerCase().includes(f) || m.pontos.some((p) => p.codigo.toLowerCase().includes(f)),
    );
  }, [lista, filtro]);

  const comPonto = lista?.filter((m) => m.pontos.length > 0).length ?? 0;
  const comAvisos = lista?.filter((m) => m.avisos > 0).length ?? 0;

  return (
    <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
            <Users size={22} /> Motoristas
            {lista && (
              <span className="rounded-full bg-[#38b6ff]/15 px-2.5 py-0.5 font-sans text-[12px] font-bold text-[#38b6ff] normal-case">
                {lista.length}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-gelo/60">
            {lista
              ? `${lista.length} motorista${lista.length === 1 ? "" : "s"} · ${comPonto} com ponto · ${comAvisos} com avisos no celular` +
                (ultimaLeitura ? ` · posições da leitura das ${hora(ultimaLeitura)}` : "")
              : "Nome e pontos de todos os motoristas. Só o administrador vê esta lista."}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gelo/70">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-[#2a5bb0]/35 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-gelo/75">Lista de motoristas cadastrados</span>
            <button
              type="button"
              onClick={() => void carregar()}
              disabled={carregando}
              aria-label="Atualizar a lista de motoristas"
              title="Atualizar"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 px-3 text-[12.5px] font-semibold text-gelo hover:border-ciano/60 hover:text-ciano disabled:opacity-60"
            >
              <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
              Atualizar
            </button>
          </div>

          {lista && lista.length > 6 && (
            <label className="relative mt-3 block">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gelo/45" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar por nome ou ponto (ex.: A32)"
                aria-label="Buscar motorista"
                className="w-full rounded-[14px] border-[1.5px] border-[#2a5bb0]/70 bg-[#06122b]/85 py-2.5 pr-3.5 pl-10 text-[15px] text-white outline-none placeholder:text-gelo/40 focus:border-ciano/70"
              />
            </label>
          )}

          {erro && <p className="mt-3 text-[14px] text-ambar">{erro}</p>}
          {!lista && !erro && <p className="mt-3 text-[14px] text-gelo/60">Carregando motoristas…</p>}
          {lista && lista.length === 0 && <p className="mt-3 text-[14px] text-gelo/60">Nenhum motorista cadastrado ainda.</p>}
          {lista && lista.length > 0 && filtrados.length === 0 && (
            <p className="mt-3 text-[14px] text-gelo/60">Nenhum motorista encontrado.</p>
          )}

          {filtrados.length > 0 && (
            <ul className="barra-rolagem mt-2 max-h-[520px] divide-y divide-[#2a5bb0]/35 overflow-y-auto">
              {filtrados.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <b className="text-[15.5px] break-words text-white">{m.nome}</b>
                    <span className="text-[12px] text-gelo/50">
                      #{m.id} · desde {dia(m.criadoEm)}
                    </span>
                    <div className="ml-auto flex items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[12px] ${m.avisos ? "text-verde" : "text-gelo/45"}`}
                      >
                        {m.avisos ? <Bell size={13} /> : <BellOff size={13} />}
                        {m.avisos ? `avisos ativos${m.avisos > 1 ? ` (${m.avisos} aparelhos)` : ""}` : "sem avisos"}
                      </span>
                      <button
                        type="button"
                        onClick={() => void excluirMotorista(m)}
                        title={`Excluir motorista ${m.nome}`}
                        aria-label={`Excluir motorista ${m.nome}`}
                        className="rounded p-1.5 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {m.pontos.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.pontos.map((p) => (
                        <Ponto key={p.id} p={p} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[13px] text-gelo/50">Nenhum ponto cadastrado</p>
                  )}
                  <AlertaMotorista m={m} api={api} onSessaoExpirada={onSessaoExpirada} onMudou={() => void carregar()} />
                </li>
              ))}
            </ul>
          )}

          {semDono.length > 0 && (
            <div className="mt-3 rounded-[14px] border border-gelo/15 bg-black/20 px-3 py-2.5">
              <p className="text-[12.5px] font-semibold text-gelo/70">Pontos sem motorista (cadastros antigos)</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {semDono.map((p) => (
                  <Ponto key={p.id} p={p} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
