"use client";
import { useEffect, useState } from "react";
import { Check, Gauge, Smartphone } from "lucide-react";

export default function ThemeSelector({ api }: { api: (path: string, init?: RequestInit) => Promise<{ ok: boolean; dados: any }> }) {
  const [theme, setTheme] = useState("original");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { let active = true; api("/api/admin/theme").then((r) => { if (active && r?.dados?.theme) setTheme(r.dados.theme); }).catch(() => {}); return () => { active = false; }; }, [api]);
  async function apply() {
    setBusy(true); setMessage("");
    try {
      const result = await api("/api/admin/theme", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) });
      if (!result?.ok || !result?.dados?.ok) throw new Error("Não foi possível salvar a preferência.");
      window.dispatchEvent(new CustomEvent("copalinks-theme", { detail: theme }));
      setMessage("Tema aplicado com sucesso!");
    } catch { setMessage("Não foi possível salvar. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 rounded-[22px] border border-[#3342d0]/60 bg-[#02063d]/90 p-4" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading" className="font-display text-lg font-bold text-ciano">Aparência do aplicativo</h2>
    <p className="mt-1 text-sm text-gelo/70">Escolha seu tema. A preferência vale somente para sua conta de administrador.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {[{ id: "original", name: "CopaLinks Original", desc: "Principal · visual atual do aplicativo", Icon: Smartphone }, { id: "truck_dashboard", name: "Painel de Caminhão", desc: "Experimental · instrumentos digitais e iluminação de cabine", Icon: Gauge }].map(({ id, name, desc, Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)} className={`rounded-2xl border p-4 text-left transition ${theme === id ? "border-ciano bg-ciano/10 shadow-[0_0_22px_#00cfff22]" : "border-white/15 bg-black/20"}`}><span className="flex items-center gap-3"><Icon className="text-ciano"/><span><b className="block text-white">{name}</b><small className="text-gelo/65">{desc}</small></span></span></button>)}
    </div>
    <button type="button" disabled={busy} onClick={() => void apply()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-700 px-5 font-semibold text-white disabled:opacity-60"><Check size={18}/>{busy ? "Aplicando…" : "Aplicar tema"}</button>
    {message && <p role="status" className="mt-2 text-sm text-emerald-300">{message}</p>}
  </section>;
}
