"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Smartphone, Wifi, WifiOff } from "lucide-react";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";
import FiltroGrupoCard from "@/components/monitor/FiltroGrupoCard";
import WhatsAppSemApkCard from "@/components/monitor/WhatsAppSemApkCard";

type Aparelho = { id: number; tipo: string; nome: string; ativo: number; ultimoContatoEm: string | null };
type Evento = { id: number; codigos: string[]; criadoEm: string; aceitas: number; falhas: number };
type Resumo = {
  monitorCount: number; receptorCount: number; codigoCount: number;
  firebaseConfigurado: boolean; devices: Aparelho[]; eventos: Evento[];
};
type Codigo = { codigo: string; expiraEm: string };

const hora = (v: string) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const TOKEN_ADMIN = "copalinks-admin-sessao";

function cabecalho(): Record<string, string> {
  try {
    const t = localStorage.getItem(TOKEN_ADMIN) || sessionStorage.getItem(TOKEN_ADMIN);
    return t ? { authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

export default function MonitorDashboard() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/monitor/overview", { cache: "no-store", credentials: "same-origin", headers: cabecalho() });
      if (r.status === 401) { setSemAcesso(true); return; }
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Não foi possível atualizar o painel."); return; }
      setSemAcesso(false); setErro(""); setResumo(d);
    } catch { setErro("Sem conexão com o monitor. Tente atualizar."); }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function gerarCodigo() {
    setOcupado(true); setErro("");
    try {
      const r = await fetch("/api/devices/register", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", ...cabecalho() },
        body: JSON.stringify({ action: "create-monitor-code" }),
      });
      const d = await r.json();
      if (r.status === 401) { setSemAcesso(true); return; }
      if (!r.ok) { setErro(d.erro || "Falha ao gerar código."); return; }
      setCodigo(d); void carregar();
    } catch { setErro("Falha de conexão ao gerar o código."); }
    finally { setOcupado(false); }
  }

  async function desativar(id: number) {
    if (!confirm("Desativar este aparelho? Ele perderá acesso imediatamente.")) return;
    setOcupado(true); setErro("");
    try {
      const r = await fetch("/api/devices/register", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", ...cabecalho() },
        body: JSON.stringify({ action: "admin-revoke", deviceId: id }),
      });
      if (!r.ok) { setErro("Não foi possível desativar este aparelho."); return; }
      void carregar();
    } catch { setErro("Falha de conexão."); }
    finally { setOcupado(false); }
  }

  return (
    <main className="fundo-app min-h-screen bg-[#002b6b] px-4 pb-16 text-white">
      <div className="mx-auto max-w-4xl pt-7">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[#9cbbeb] hover:text-white">
          <ArrowLeft size={18} /> Voltar ao administrador
        </Link>
        <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-ciano">CopaLinks · área restrita</div>
            <h1 className="mt-1 font-display text-3xl font-extrabold">Monitor WhatsApp</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#b8c9e5]">
              Acompanhe apenas códigos escolhidos pelos motoristas. Nenhuma conversa, remetente ou telefone é salvo.
            </p>
          </div>
          <button onClick={() => void carregar()} type="button" aria-label="Atualizar monitor" className="rounded-full border border-[#365e9f] bg-[#0c2248] p-3 text-ciano hover:bg-[#143367]">
            <RefreshCw size={19} />
          </button>
        </div>

        {!semAcesso && resumo && (
          <div className="mt-5 rounded-[18px] border border-ciano/45 bg-[#0b2146] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ciano">Grupo permitido no Android monitor</p>
            <p className="mt-1 break-words font-display text-lg font-bold text-white">{NOME_GRUPO_MONITORADO}</p>
            <p className="mt-1 text-xs text-[#b8c9e5]">Somente notificações confirmadas deste grupo; outros grupos e conversas individuais são ignorados.</p>
          </div>
        )}

        {semAcesso ? (
          <section className="mt-8 rounded-3xl border border-amber-500/50 bg-[#1d1d31] p-6">
            <h2 className="font-display text-lg font-bold">Acesso restrito</h2>
            <p className="mt-2 text-[#b8c9e5]">Entre primeiro no painel de administração do CopaLinks.</p>
            <Link href="/admin" className="mt-4 inline-block rounded-full bg-ouro px-5 py-3 font-bold text-[#282000]">Entrar no /admin</Link>
          </section>
        ) : (
          <>
            {erro && <p role="alert" className="mt-5 rounded-xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-red-100">{erro}</p>}
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Wifi, titulo: "Aparelhos monitor", valor: resumo?.monitorCount ?? "—" },
                { icon: Bell, titulo: "Celulares receptores", valor: resumo?.receptorCount ?? "—" },
                { icon: ShieldCheck, titulo: "Códigos ativos", valor: resumo?.codigoCount ?? "—" },
              ].map((x) => <div key={x.titulo} className="rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-5">
                <x.icon className="text-ciano" size={22} /><p className="mt-4 text-3xl font-bold">{x.valor}</p>
                <p className="mt-1 text-sm text-[#b8c9e5]">{x.titulo}</p>
              </div>)}
            </div>

            <section className="mt-6 rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-5">
              <div className="flex items-center gap-2 font-display text-lg font-bold"><Smartphone size={21} className="text-ciano" /> Parear Android monitor</div>
              <p className="mt-2 text-sm leading-relaxed text-[#b8c9e5]">Instale o app Android Monitor em um aparelho sob sua responsabilidade, conceda acesso a notificações nas Configurações do Android e digite o código gerado aqui. O código dura 10 minutos e só funciona uma vez.</p>
              <p className="mt-3 text-sm">Firebase: <strong className={resumo?.firebaseConfigurado ? "text-verde" : "text-ambar"}>{resumo?.firebaseConfigurado ? "configurado" : "ainda não configurado"}</strong></p>
              <button type="button" disabled={ocupado} onClick={() => void gerarCodigo()}
                className="mt-4 rounded-full bg-ouro px-6 py-3 font-display text-sm font-bold text-[#281e00] disabled:opacity-50">{ocupado ? "Aguarde…" : "Gerar código do monitor"}</button>
              {codigo && <div className="mt-4 rounded-xl border border-[#37c9ce]/50 bg-[#06162f] p-4" role="status">
                <p className="text-sm text-[#b8c9e5]">Mostrado uma única vez; digite no Android Monitor:</p>
                <p className="mt-2 break-all font-mono text-xl font-bold tracking-[0.16em] text-ciano">{codigo.codigo}</p>
                <p className="mt-2 text-xs text-[#b8c9e5]">Vence em {hora(codigo.expiraEm)}. Não compartilhe em grupos.</p>
              </div>}
            </section>

            <section className="mt-6 rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-5">
              <h2 className="font-display text-lg font-bold">Aparelhos pareados</h2>
              <div className="mt-3 space-y-2">
                {resumo?.devices?.length ? resumo.devices.map((d) => <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2c518d]/65 bg-[#071a35] p-3 text-sm">
                  {d.ativo ? <CheckCircle2 size={18} className="text-verde" /> : <WifiOff size={18} className="text-gelo/45" />}
                  <span className="min-w-0 flex-1"><b>{d.nome || "Android CopaLinks"}</b> <span className="text-[#b8c9e5]">· {d.tipo === "MONITOR" ? "monitor" : "receptor"}{d.ativo ? " · ativo" : " · revogado"}</span></span>
                  <span className="text-xs text-[#b8c9e5]">{d.ultimoContatoEm ? `Visto ${hora(d.ultimoContatoEm)}` : "Sem contato"}</span>
                  {!!d.ativo && <button type="button" disabled={ocupado} onClick={() => void desativar(d.id)} className="rounded-full border border-red-400/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40">Revogar</button>}
                </div>) : <p className="text-sm text-[#b8c9e5]">Nenhum Android pareado ainda.</p>}
              </div>
            </section>

            <WhatsAppSemApkCard cabecalho={cabecalho} />

            <FiltroGrupoCard cabecalho={cabecalho} />

            <section className="mt-6 rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-5">
              <h2 className="font-display text-lg font-bold">Eventos recentes</h2>
              <p className="mt-1 text-xs text-[#b8c9e5]">Só códigos ou a contagem de códigos (filtro do grupo), sem o texto das mensagens. &quot;Aceitos&quot; conta o FCM do receptor Android; os avisos do filtro do grupo saem pelo Web Push do app.</p>
              <div className="mt-4 space-y-2">
                {resumo?.eventos?.length ? resumo.eventos.map((e) => <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#2c518d]/65 bg-[#071a35] p-3 text-sm">
                  <Clock3 size={17} className="text-ciano" /> <span className="text-xs text-[#b8c9e5]">{hora(e.criadoEm)}</span>
                  <span className="font-mono font-bold text-white">{e.codigos.join(", ")}</span>
                  <span className="ml-auto text-xs text-verde">{e.aceitas} aceitos</span>
                  {e.falhas > 0 && <span className="text-xs text-red-200">{e.falhas} falhas</span>}
                </div>) : <p className="text-sm text-[#b8c9e5]">Nenhum evento recebido. Confira se há monitor pareado, permissão de notificações e códigos ativos.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
