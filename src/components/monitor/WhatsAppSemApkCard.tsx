"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Link2, Power, TriangleAlert } from "lucide-react";
import { NOME_GRUPO_MONITORADO } from "@/lib/monitor-group-name";

type Status = {
  configurado: boolean;
  segredoCriadoEm: string | null;
  segredoNoAmbiente: boolean;
  grupoId: string | null;
  grupoIdOrigem: "ambiente" | "automatico" | null;
  ultimoContato: string | null;
  ultimaMensagemGrupo: string | null;
  listas: { codigos: string[]; criadoEm: string }[];
};
type Gerado = { endereco: string; enderecoComSegredo: string; segredo: string };

const quando = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca";

/**
 * Card do administrador (/monitor): filtro do grupo SEM APK. Gera o endereço
 * (webhook) para colar no serviço de WhatsApp Web e mostra se as mensagens
 * do grupo estão chegando. O segredo aparece uma única vez.
 */
export default function WhatsAppSemApkCard({ cabecalho }: { cabecalho: () => Record<string, string> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/whatsapp-webhook", { credentials: "same-origin", headers: cabecalho(), cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* tenta de novo no próximo ciclo */
    }
  }, [cabecalho]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function acao(metodo: "POST" | "DELETE") {
    const pergunta = metodo === "DELETE"
      ? "Desligar a leitura do grupo pelo servidor? O endereço atual para de funcionar."
      : status?.configurado
        ? "Gerar um NOVO endereço? O endereço atual para de funcionar e terá de ser trocado no serviço."
        : null;
    if (pergunta && !window.confirm(pergunta)) return;
    setOcupado(true); setErro("");
    try {
      const r = await fetch("/api/admin/whatsapp-webhook", { method: metodo, credentials: "same-origin", headers: cabecalho() });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Não foi possível concluir."); return; }
      setStatus(d.status);
      setGerado(metodo === "POST" ? { endereco: d.endereco, enderecoComSegredo: d.enderecoComSegredo, segredo: d.segredo } : null);
    } catch { setErro("Sem conexão. Tente de novo."); }
    finally { setOcupado(false); }
  }

  async function copiar(rotulo: string, valor: string) {
    try { await navigator.clipboard.writeText(valor); setCopiado(rotulo); setTimeout(() => setCopiado(""), 2000); }
    catch { setErro("Não foi possível copiar; selecione e copie manualmente."); }
  }

  const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
    <div className="mt-3">
      <p className="text-xs text-[#b8c9e5]">{rotulo}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-[#06162f] px-3 py-2 font-mono text-[13px] text-ciano">{valor}</code>
        <button type="button" onClick={() => void copiar(rotulo, valor)} aria-label={`Copiar ${rotulo}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2c518d] hover:bg-white/5">
          {copiado === rotulo ? <CheckCircle2 size={18} className="text-verde" /> : <Copy size={18} />}
        </button>
      </div>
    </div>
  );

  return (
    <section className="mt-6 rounded-[22px] border border-[#2c518d] bg-[#0b2146] p-5">
      <div className="flex items-center gap-2 font-display text-lg font-bold"><Link2 size={21} className="text-ciano" /> Filtro do grupo sem APK (pelo servidor)</div>
      <p className="mt-2 text-sm leading-relaxed text-[#b8c9e5]">
        Um número de WhatsApp que participa do grupo <b>{NOME_GRUPO_MONITORADO}</b> fica conectado a um serviço de WhatsApp Web
        (recomendado: <b>Green-API</b>). A cada mensagem, o serviço avisa o CopaLinks, que lê só esse grupo e avisa cada motorista do
        próprio ponto pelas notificações do app. Nenhum motorista precisa instalar nada.
      </p>
      <p className="mt-2 flex gap-2 rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-ambar" />
        Conexão não oficial do WhatsApp: use um <b>número dedicado</b> (chip só para isso), não o seu pessoal — existe risco de bloqueio do número.
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-[#071a35] p-3"><dt className="text-xs text-[#b8c9e5]">Endereço (webhook)</dt>
          <dd className={status?.configurado ? "font-bold text-verde" : "font-bold text-ambar"}>{status?.configurado ? `ativo${status.segredoNoAmbiente ? " (variável da Vercel)" : ""}` : "não gerado"}</dd></div>
        <div className="rounded-xl bg-[#071a35] p-3"><dt className="text-xs text-[#b8c9e5]">Serviço falou com o CopaLinks</dt><dd>{quando(status?.ultimoContato ?? null)}</dd></div>
        <div className="rounded-xl bg-[#071a35] p-3"><dt className="text-xs text-[#b8c9e5]">Última mensagem do grupo</dt><dd>{quando(status?.ultimaMensagemGrupo ?? null)}</dd></div>
        <div className="rounded-xl bg-[#071a35] p-3"><dt className="text-xs text-[#b8c9e5]">Grupo identificado</dt>
          <dd className="break-all">{status?.grupoId ? `${status.grupoId} (${status.grupoIdOrigem === "ambiente" ? "fixo na Vercel" : "automático"})` : "aguardando a 1ª mensagem do grupo"}</dd></div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={ocupado} onClick={() => void acao("POST")}
          className="rounded-full bg-ouro px-6 py-3 font-display text-sm font-bold text-[#281e00] disabled:opacity-50">
          {ocupado ? "Aguarde…" : status?.configurado ? "Gerar novo endereço" : "Gerar endereço"}
        </button>
        {status?.configurado && !status.segredoNoAmbiente && (
          <button type="button" disabled={ocupado} onClick={() => void acao("DELETE")}
            className="flex items-center gap-2 rounded-full border border-red-400/40 px-5 py-3 text-sm text-red-200 hover:bg-red-950/40 disabled:opacity-50">
            <Power size={16} /> Desligar
          </button>
        )}
      </div>
      {erro && <p className="mt-3 text-sm text-red-300" role="alert">{erro}</p>}

      {gerado && (
        <div className="mt-4 rounded-xl border border-[#37c9ce]/50 bg-[#071a35] p-4" role="status">
          <p className="text-sm font-bold text-ciano">Mostrado uma única vez — copie agora. Não compartilhe em grupos.</p>
          <Linha rotulo="URL do webhook" valor={gerado.endereco} />
          <Linha rotulo="Token do webhook" valor={gerado.segredo} />
          <Linha rotulo="Se o serviço só aceita URL (ex.: Z-API): URL com token" valor={gerado.enderecoComSegredo} />
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[#b8c9e5]">
            <li>Em <b>console.green-api.com</b>, crie uma instância e escaneie o QR Code com o WhatsApp do número dedicado (que participa do grupo).</li>
            <li>Nas configurações da instância, cole a <b>URL do webhook</b> em &quot;URL para notificações&quot; e o <b>Token do webhook</b> em &quot;Token de autorização&quot;.</li>
            <li>Ligue <b>&quot;Receber notificações sobre mensagens recebidas&quot;</b> e salve. Em alguns minutos, &quot;Serviço falou com o CopaLinks&quot; muda para agora.</li>
          </ol>
        </div>
      )}

      {Boolean(status?.listas?.length) && (
        <div className="mt-4">
          <p className="text-xs text-[#b8c9e5]">Listas processadas pelo servidor (sem o texto):</p>
          <ul className="mt-2 space-y-1 text-sm">
            {status!.listas.map((l, i) => (
              <li key={i} className="rounded-lg bg-[#071a35] px-3 py-2"><span className="text-xs text-[#b8c9e5]">{quando(l.criadoEm)}</span> · {l.codigos.join(" · ")}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
