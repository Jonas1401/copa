"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Smartphone, Trash2 } from "lucide-react";
import { normalizarCodigo } from "@/lib/matcher";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";

type Codigo = { id: number; codigo: string; ativo: number };
type Pairing = { codigo: string; expiraEm: string };
type Aviso = { codigo: string; status: string; criadoEm: string };
type Aparelho = { id: number; nome: string; ativo: number; ultimoContatoEm: string | null };

/** Os códigos WhatsApp são opt-in e NÃO cadastram pontos na fila da Copadubo. */
export default function MonitorCodesCard({ motoristaId }: { motoristaId: number | null }) {
  const [codes, setCodes] = useState<Codigo[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aparelhos, setAparelhos] = useState<Aparelho[]>([]);
  const [resultadoTeste, setResultadoTeste] = useState("");
  const [value, setValue] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const carregar = useCallback(async () => {
    if (!motoristaId) return;
    try {
      const [c, n, d] = await Promise.all([
        fetch("/api/codes", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/notifications", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/devices/register", { cache: "no-store", credentials: "same-origin" }),
      ]);
      if (c.ok) { const j = await c.json(); setCodes(j.codigos ?? []); setReady(true); }
      else if (c.status === 401) setError("Reabra o seu perfil neste aparelho para acompanhar códigos.");
      if (n.ok) { const j = await n.json(); setAvisos(j.avisos ?? []); }
      if (d.ok) { const j = await d.json(); setAparelhos(j.aparelhos ?? []); }
    } catch { setError("Sem conexão para carregar seus códigos."); }
  }, [motoristaId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const codigo = normalizarCodigo(value);
    if (!codigo) { setError("Digite A, B ou M seguido de um número (ex.: A184)."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/codes", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.erro ?? "Não foi possível cadastrar.");
      else { setValue(""); await carregar(); }
    } catch { setError("Sem conexão. Tente de novo."); }
    finally { setBusy(false); }
  }

  async function alterar(id: number, ativo: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/codes", {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ativo }),
      });
      if (!r.ok) setError("Não foi possível alterar o código."); else await carregar();
    } catch { setError("Sem conexão."); } finally { setBusy(false); }
  }

  async function remover(id: number) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/codes", {
        method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
      });
      if (!r.ok) setError("Não foi possível remover o código."); else await carregar();
    } catch { setError("Sem conexão."); } finally { setBusy(false); }
  }

  async function gerarPareamento() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/devices/register", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create-receiver-code" }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.erro ?? "Falha ao criar o código do Android."); else setPairing(j);
    } catch { setError("Sem conexão."); } finally { setBusy(false); }
  }

  async function testarAparelho(deviceId: number) {
    setBusy(true); setResultadoTeste(""); setError("");
    try {
      const r = await fetch("/api/notifications", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId }) });
      const j = await r.json();
      if (!r.ok) setError(j.erro ?? "Não foi possível testar o Firebase.");
      else setResultadoTeste(j.mensagem ?? "Teste enviado. Confira o aparelho Android.");
    } catch { setError("Sem conexão para testar."); }
    finally { setBusy(false); }
  }

  if (!motoristaId) return null;
  return (
    <section className="painel p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-white"><Smartphone size={22} className="text-ciano" /> Monitor WhatsApp</h2>
      <p className="mt-2 text-sm leading-relaxed text-gelo/75">
        Escolha códigos A/B/M para acompanhar do grupo <b className="text-white">{NOME_GRUPO_MONITORADO}</b> no Android CopaLinks.
        Outros grupos e conversas privadas são ignorados. Esta lista é separada dos seus pontos na fila;
        só os códigos, nunca conversas ou remetentes, chegam ao servidor.
      </p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
      <form onSubmit={(e) => void adicionar(e)} className="mt-4 flex gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 10))}
          aria-label="Código do WhatsApp" placeholder="Ex.: A184, B22, M69" inputMode="text" autoComplete="off"
          className="min-w-0 flex-1 rounded-full border border-[#2a5bb0] bg-[#06122b] px-4 py-2.5 text-sm text-white outline-none focus:border-ciano" />
        <button disabled={busy || !value.trim()} className="flex items-center gap-1 rounded-full bg-ouro px-4 py-2.5 text-sm font-bold text-[#241900] disabled:opacity-50"><Plus size={17} /> Adicionar</button>
      </form>
      {ready && <div className="mt-4 space-y-2">
        {!codes.length && <p className="text-sm text-gelo/65">Nenhum código cadastrado. Os pontos do quadro não são inscritos automaticamente aqui.</p>}
        {codes.map((c) => <div key={c.id} className="flex items-center gap-2 rounded-xl border border-[#2a5bb0]/55 bg-[#06122b]/70 px-3 py-2 text-sm">
          <b className={c.ativo ? "flex-1 font-mono text-ciano" : "flex-1 font-mono text-gelo/45"}>{c.codigo}</b>
          <button type="button" disabled={busy} onClick={() => void alterar(c.id, !c.ativo)} className="text-xs text-gelo/80 underline disabled:opacity-50">{c.ativo ? "Pausar" : "Ativar"}</button>
          <button type="button" disabled={busy} onClick={() => void remover(c.id)} aria-label={`Remover ${c.codigo}`} className="text-red-300 disabled:opacity-50"><Trash2 size={16} /></button>
        </div>)}
      </div>}
      <div className="mt-5 border-t border-[#2a5bb0]/45 pt-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Bell size={17} className="text-verde" /> Receber no Android</h3>
        <p className="mt-1 text-xs leading-relaxed text-gelo/70">Instale o Android Monitor CopaLinks e digite o código temporário de pareamento para associar o celular a este perfil. É necessário o Firebase configurado pelo administrador.</p>
        <button type="button" disabled={busy} onClick={() => void gerarPareamento()}
          className="mt-3 rounded-full border border-ciano/60 px-4 py-2 text-sm font-semibold text-ciano disabled:opacity-50">Gerar código para meu Android</button>
        {pairing && <div role="status" className="mt-3 rounded-xl border border-verde/35 bg-[#0b2630] p-3">
          <p className="text-xs text-gelo/70">Digite no Android (uma vez só):</p>
          <p className="mt-1 break-all font-mono text-lg font-bold tracking-widest text-verde">{pairing.codigo}</p>
          <p className="mt-1 text-xs text-gelo/60">Vence em {new Date(pairing.expiraEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Não compartilhe.</p>
        </div>}
        {aparelhos.filter((a) => a.ativo).map((a) => <div key={a.id} className="mt-2 flex items-center gap-2 rounded-xl border border-[#2a5bb0]/50 bg-[#06122b]/70 px-3 py-2 text-xs text-gelo/80">
          <Smartphone size={15} className="shrink-0 text-verde" />
          <span className="min-w-0 flex-1 truncate">{a.nome || "Android pareado"}</span>
          <button type="button" disabled={busy} onClick={() => void testarAparelho(a.id)} className="rounded-full border border-ciano/50 px-3 py-1.5 font-semibold text-ciano disabled:opacity-50">Testar Firebase</button>
        </div>)}
        {resultadoTeste && <p role="status" className="mt-2 text-xs text-verde">{resultadoTeste}</p>}
      </div>
      {!!avisos.length && <div className="mt-4 border-t border-[#2a5bb0]/45 pt-3">
        <p className="mb-2 text-xs font-semibold text-gelo/75">Últimos envios ao Firebase (não confirma exibição no celular)</p>
        {avisos.slice(0, 4).map((a, i) => <p key={i} className="text-xs text-gelo/65">{a.codigo} · {a.status} · {new Date(a.criadoEm).toLocaleString("pt-BR")}</p>)}
      </div>}
    </section>
  );
}
