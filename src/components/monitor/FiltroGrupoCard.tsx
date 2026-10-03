"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";

type Resultado = {
  naVez: string[];
  pulados: string[];
  avisos: { motorista: string; aviso: string }[];
  entrega: { avisados: number; semAparelho: number; repetidos: number; falhas: number } | null;
};

const EXEMPLO = "PONTOS NA VEZ\n\nCARRETAS TRUCADAS (A):\nA014 - A016 - A017 - A018 - A019 - A021 - A023 - A024\n\nTRUCADAS PULADAS:\nA137 - A140 - A144 - A146 - A147";

/**
 * Card do administrador (/monitor): cola uma mensagem do grupo e vê o que o
 * filtro automático encontra e quem receberia cada aviso. "Enviar avisos"
 * entrega de verdade (mesma trava de 1 aviso por dia por ponto).
 */
export default function FiltroGrupoCard({ cabecalho }: { cabecalho: () => Record<string, string> }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function testar(enviar: boolean) {
    if (enviar && !window.confirm("Enviar os avisos de verdade para os motoristas encontrados?")) return;
    setOcupado(true); setErro("");
    try {
      const r = await fetch("/api/admin/grupo-teste", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", ...cabecalho() },
        body: JSON.stringify({ texto: texto || EXEMPLO, enviar }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Não foi possível testar."); return; }
      setResultado(d);
    } catch { setErro("Sem conexão. Tente de novo."); }
    finally { setOcupado(false); }
  }

  return (
    <section className="mt-4 rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-white">
            <Filter size={20} className="text-ciano" /> Filtro automático do grupo
          </h2>
          <p className="mt-0.5 text-xs text-[#b8c9e5]">
            Simular e enviar avisos a partir das mensagens do grupo
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#b8c9e5]">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-[#2c518d]/50 pt-3">
          <p className="text-sm leading-relaxed text-[#b8c9e5]">
            O Monitor Android envia as mensagens de <b>{NOME_GRUPO_MONITORADO}</b> com <b>PONTOS NA VEZ</b> ou <b>PULADAS</b>.
            Cada motorista recebe só o aviso do próprio ponto (🔔 Ponto na vez nº A014 · ⚠️ Ponto pulado nº A137).
            Cole uma mensagem abaixo para conferir o filtro.
          </p>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} placeholder={EXEMPLO}
            className="mt-4 w-full rounded-xl border border-[#2c518d] bg-[#06162f] p-3 font-mono text-sm text-white placeholder:text-[#b8c9e5]/45" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={ocupado} onClick={() => void testar(false)}
              className="rounded-full bg-ouro px-5 py-2.5 font-display text-sm font-bold text-[#281e00] disabled:opacity-50">{ocupado ? "Aguarde…" : "Simular (não envia)"}</button>
            <button type="button" disabled={ocupado} onClick={() => void testar(true)}
              className="rounded-full border border-ouro/60 px-5 py-2.5 font-display text-sm font-bold text-ouro disabled:opacity-50">Enviar avisos</button>
          </div>
          {erro && <p className="mt-3 text-sm text-red-200" role="alert">{erro}</p>}
          {resultado && <div className="mt-4 space-y-2 text-sm" role="status">
            <p><b className="text-verde">Na vez ({resultado.naVez.length}):</b> <span className="font-mono">{resultado.naVez.join(" ") || "—"}</span></p>
            <p><b className="text-ambar">Pulados ({resultado.pulados.length}):</b> <span className="font-mono">{resultado.pulados.join(" ") || "—"}</span></p>
            <p className="pt-1 font-bold">Avisos para motoristas cadastrados: {resultado.avisos.length}</p>
            {resultado.avisos.map((a, i) => <p key={i} className="rounded-lg bg-[#071a35] px-3 py-2">{a.motorista} → {a.aviso}</p>)}
            {resultado.entrega && <p className="text-xs text-[#b8c9e5]">
              Entregues: {resultado.entrega.avisados} · sem notificação ativa: {resultado.entrega.semAparelho} · já avisados hoje: {resultado.entrega.repetidos}{resultado.entrega.falhas ? ` · falhas: ${resultado.entrega.falhas}` : ""}
            </p>}
          </div>}
        </div>
      )}
    </section>
  );
}
