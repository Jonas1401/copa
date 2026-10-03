"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";

/**
 * Situação do RADAR DA PREVISÃO (monitoramento constante do tempo).
 *
 * O radar roda no servidor (`/api/cron`, a cada minuto): relê o SIMPORT®/APPA
 * pela API e o painel público PELO COMPOSIO, compara com a última leitura e
 * manda QUALQUER mudança para o chat dos motoristas + Web Push — a notificação
 * chega mesmo com o aplicativo fechado.
 *
 * Este cartão só mostra o estado (não escreve nada): se está ligado, de quanto
 * em quanto tempo lê, quando foi a última leitura, a última mudança avisada e
 * quais fontes estão no ar. O botão "Verificar agora" aparece para o
 * administrador e roda um ciclo imediato.
 */

export type StatusRadar = {
  ativo: boolean;
  sensibilidade: "baixa" | "media" | "alta";
  intervaloMin: number;
  painelMin: number;
  ultimaVerificacao: string | null;
  ultimaMudanca: { em: string; resumo: string; grave: boolean } | null;
  mudancas24h: number;
  fontes: { simport: boolean; estacao: boolean; painel: boolean; composio: boolean };
  composio: boolean;
};

const SENSIBILIDADE: Record<StatusRadar["sensibilidade"], string> = {
  baixa: "só mudança grande",
  media: "mudança média",
  alta: "qualquer mudança",
};

function horaMin(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default function CartaoRadarPrevisao({ inicial }: { inicial?: StatusRadar | null } = {}) {
  const [s, setS] = useState<StatusRadar | null>(inicial ?? null);
  const [admin, setAdmin] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [aviso, setAviso] = useState("");

  const buscar = useCallback(async () => {
    try {
      const r = await fetch("/api/tempo/radar", { cache: "no-store" });
      if (r.ok) setS((await r.json()) as StatusRadar);
    } catch {
      /* sem rede: o cartão simplesmente não aparece */
    }
  }, []);

  useEffect(() => {
    // Com o status já renderizado no servidor, não precisa buscar na 1ª tela.
    if (inicial) return;
    void buscar();
    const t = setInterval(() => void buscar(), 60_000);
    return () => clearInterval(t);
  }, [inicial, buscar]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/admin/sessao", { cache: "no-store" });
        if (r.ok) setAdmin(Boolean((await r.json())?.logado));
      } catch {
        /* mantém sem o botão */
      }
    })();
  }, []);

  async function verificarAgora() {
    setRodando(true);
    setAviso("");
    try {
      const r = await fetch("/api/tempo/radar", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setAviso(
        r.ok
          ? d.postou
            ? `Mudança avisada no chat: ${(d.mudancas ?? []).join(", ")}`
            : (d.motivo ?? "Ciclo rodado.")
          : (d.erro ?? "Não foi possível rodar o radar."),
      );
      await buscar();
    } catch {
      setAviso("Não foi possível rodar o radar.");
    } finally {
      setRodando(false);
    }
  }

  if (!s) return null;

  const ligado = s.ativo;
  return (
    <section className="rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
        <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
          <Radar size={26} strokeWidth={2.2} /> Radar da previsão
        </h2>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-bold ${
            ligado ? "bg-verde/20 text-verde" : "bg-gelo/15 text-gelo/70"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${ligado ? "bg-verde" : "bg-gelo/50"}`} />
          {ligado ? "Monitorando" : "Desligado"}
        </span>
      </div>

      <p className="px-0.5 text-[13.5px] leading-snug text-gelo/85">
        O CopaLinks acompanha o SIMPORT® – Dashboard Meteoceanográfico da APPA de{" "}
        <b className="text-white">{s.intervaloMin} em {s.intervaloMin} minutos</b> (o painel completo,
        lido pelo Composio, a cada <b className="text-white">{s.painelMin} minutos</b>). Qualquer
        mudança na previsão entra no chat e chega como notificação, mesmo com o aplicativo fechado.
      </p>

      <dl className="mt-2.5 space-y-1.5 px-0.5 text-[13px]">
        <div className="flex gap-2">
          <dt className="shrink-0 text-gelo/70">Sensibilidade</dt>
          <dd className="text-white">{SENSIBILIDADE[s.sensibilidade]}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-gelo/70">Última leitura</dt>
          <dd className="text-white">
            {s.ultimaVerificacao ? horaMin(s.ultimaVerificacao) : "ainda não rodou"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-gelo/70">Última mudança</dt>
          <dd className="min-w-0 text-white">
            {s.ultimaMudanca ? (
              <>
                <span className="text-gelo/70">{horaMin(s.ultimaMudanca.em)} — </span>
                {s.ultimaMudanca.resumo}
              </>
            ) : (
              "nenhuma desde que o radar começou"
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-gelo/70">Fontes no ar</dt>
          <dd className="text-white">
            {[
              s.fontes.simport ? "SIMPORT (API)" : null,
              s.fontes.painel ? "Painel da APPA (Composio)" : null,
              s.fontes.estacao ? "Estação do porto" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "aguardando a próxima leitura"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-gelo/70">Avisos em 24 h</dt>
          <dd className="text-white">{s.mudancas24h}</dd>
        </div>
      </dl>

      {!s.composio && (
        <p className="mt-2 rounded-[12px] bg-ambar/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-ambar">
          Cadastre a chave do Composio em <b>/admin → Integrações</b> para o radar ler também o
          painel completo da APPA (boletim, marés e tabelas de chuva e vento).
        </p>
      )}

      {admin && (
        <button
          type="button"
          onClick={() => void verificarAgora()}
          disabled={rodando}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-[#38b6ff]/60 bg-[#0e2c63]/80 px-4 py-2.5 font-display text-[14px] font-bold tracking-wide text-[#8fd6ff] uppercase disabled:opacity-60"
        >
          <RefreshCw size={16} className={rodando ? "animate-spin" : ""} />
          {rodando ? "Verificando…" : "Verificar agora (admin)"}
        </button>
      )}
      {aviso && <p className="mt-2 px-0.5 text-[12.5px] text-[#8fd6ff]">{aviso}</p>}
    </section>
  );
}
