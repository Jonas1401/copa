"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, RefreshCw, ScanSearch } from "lucide-react";

/**
 * Situação do RADAR DA PREVISÃO (monitoramento constante do tempo) — agora
 * exclusivo da ÁREA DO ADMINISTRADOR (`/admin`). A tela pública do Tempo não
 * mostra mais este cartão: o motorista continua recebendo os avisos no chat e
 * como notificação, mas o diagnóstico fica só com quem administra.
 *
 * O radar roda no servidor (`/api/cron`, a cada minuto): relê o SIMPORT®/APPA
 * pela API e o painel público (por vários métodos, com troca automática:
 * API → HTML → navegador automático → OCR → Composio), compara com a última
 * leitura e manda QUALQUER mudança para o chat dos motoristas + Web Push — a
 * notificação chega mesmo com o aplicativo fechado.
 *
 * Este cartão mostra o estado: se está ligado, de quanto em quanto tempo lê, a
 * situação do painel da APPA ("Painel APPA: conectado" + "Método de leitura"),
 * a última mudança avisada, as fontes no ar e o log de diagnóstico de cada
 * tentativa. Erro só aparece quando TODOS os métodos falham. Só aparece depois
 * do login, então os botões "Verificar agora" e "Ler painel agora" ficam sempre
 * disponíveis (`POST /api/tempo/radar`).
 */

export type StatusPainel = {
  em: string | null;
  erro: string | null;
  situacao: "conectado" | "leitura-realizada" | "erro" | "aguardando";
  rotulo: string;
  metodo: "api" | "html" | "playwright" | "ocr" | "composio" | null;
  metodoRotulo: string | null;
  tentativaEm: string | null;
  parcial: boolean;
  log: string[];
  leitura: {
    fonte: string;
    timestamp_leitura: string;
    atualizado_em: string | null;
    temperatura: string | null;
    sensacao_termica: string | null;
    chuva: string | null;
    chuva_forte: string | null;
    tempestade: string | null;
    vento: string | null;
    umidade: string | null;
    pressao: string | null;
    alertas: string[];
    status: "sucesso" | "parcial";
    metodo_leitura: string;
  } | null;
};

/** Espelha `StatusRadarClima` (src/lib/clima-monitor.ts): mexeu num, mexa no outro. */
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
  painel: StatusPainel;
  composioErro: string | null;
};

const SENSIBILIDADE: Record<StatusRadar["sensibilidade"], string> = {
  baixa: "só mudança grande",
  media: "mudança média",
  alta: "qualquer mudança",
};

/** Token da sessão do administrador (o mesmo usado pelo restante do painel). */
const CHAVE_TOKEN = "copalinks-admin-sessao";

function cabecalhoAdmin(): Record<string, string> {
  try {
    const t = localStorage.getItem(CHAVE_TOKEN) || sessionStorage.getItem(CHAVE_TOKEN);
    return t ? { authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

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

export default function CartaoRadarPrevisaoAdmin({ inicial }: { inicial?: StatusRadar | null } = {}) {
  const [s, setS] = useState<StatusRadar | null>(inicial ?? null);
  const [rodando, setRodando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState("");

  const buscar = useCallback(async () => {
    try {
      const r = await fetch("/api/tempo/radar", {
        cache: "no-store",
        credentials: "same-origin",
        headers: cabecalhoAdmin(),
      });
      if (r.ok) setS((await r.json()) as StatusRadar);
      else if (r.status === 401) setS(null);
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

  async function verificarAgora() {
    setRodando(true);
    setAviso("");
    try {
      const r = await fetch("/api/tempo/radar", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: cabecalhoAdmin(),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setAviso("Sessão expirada. Entre novamente no painel para rodar o radar.");
        return;
      }
      setAviso(
        r.ok
          ? d.postou
            ? `Mudança avisada no chat: ${(d.mudancas ?? []).join(", ")}`
            : (d.motivo ?? "Ciclo rodado.")
          : (d.erro ?? "Não foi possível rodar o radar."),
      );
      if (d.status) setS(d.status as StatusRadar);
      else await buscar();
    } catch {
      setAviso("Não foi possível rodar o radar.");
    } finally {
      setRodando(false);
    }
  }

  /** Lê o painel agora por todos os métodos (só diagnóstico: não avisa ninguém). */
  async function lerPainelAgora() {
    setLendo(true);
    setAviso("");
    try {
      const r = await fetch("/api/tempo/radar?painel=1", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: cabecalhoAdmin(),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setAviso("Sessão expirada. Entre novamente no painel para ler o painel da APPA.");
        return;
      }
      setAviso(
        r.ok
          ? d.leitura
            ? `Painel lido pelo método ${d.metodoRotulo} em ${((d.duracaoMs ?? 0) / 1000).toFixed(1).replace(".", ",")} s.`
            : (d.erro ?? "Nenhum método conseguiu ler o painel.")
          : (d.erro ?? "Não foi possível ler o painel."),
      );
      if (d.status) setS(d.status as StatusRadar);
      else await buscar();
    } catch {
      setAviso("Não foi possível ler o painel.");
    } finally {
      setLendo(false);
    }
  }

  if (!s) return null;

  const ligado = s.ativo;
  return (
    <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
        <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
          <Radar size={22} strokeWidth={2.2} /> Radar da previsão
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
        <b className="text-white">{s.intervaloMin} em {s.intervaloMin} minutos</b>. O painel é lido pelo
        servidor por vários métodos (API, HTML, navegador automático, OCR e Composio) e, se um falha, o
        próximo assume sozinho. Qualquer mudança na previsão entra no chat e chega como notificação,
        mesmo com o aplicativo fechado.
      </p>

      <div
        className={`mt-2.5 rounded-[14px] border px-3 py-2 ${
          s.painel.situacao === "erro"
            ? "border-ambar/50 bg-ambar/10"
            : "border-[#2a5bb0]/60 bg-[#0b2150]/70"
        }`}
      >
        <p className="flex items-center gap-2 text-[14px] font-bold text-white">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              s.painel.situacao === "erro"
                ? "bg-ambar"
                : s.painel.situacao === "aguardando"
                  ? "bg-gelo/50"
                  : "bg-verde"
            }`}
          />
          {s.painel.rotulo}
        </p>
        {s.painel.metodoRotulo && s.painel.situacao !== "erro" && (
          <p className="mt-0.5 text-[13px] text-gelo/85">
            Método de leitura: <b className="text-white">{s.painel.metodoRotulo}</b>
            {s.painel.parcial ? " (leitura parcial)" : ""}
          </p>
        )}
        {s.painel.em && s.painel.situacao !== "erro" && (
          <p className="text-[12.5px] text-gelo/70">Lido em {horaMin(s.painel.em)}</p>
        )}
        {s.painel.leitura && s.painel.situacao !== "erro" && (
          <p className="mt-1 text-[12.5px] leading-snug text-gelo/85">
            {[
              s.painel.leitura.temperatura,
              s.painel.leitura.vento ? `vento ${s.painel.leitura.vento.split(" · ")[0]}` : null,
              s.painel.leitura.umidade ? `umidade ${s.painel.leitura.umidade}` : null,
              s.painel.leitura.pressao ? `pressão ${s.painel.leitura.pressao}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {s.painel.leitura.chuva ? ` · ${s.painel.leitura.chuva}` : ""}
          </p>
        )}
        {s.painel.leitura && s.painel.situacao !== "erro" && s.painel.leitura.alertas.length > 0 && (
          <p className="mt-1 text-[12.5px] leading-snug text-ambar">
            ⚠️ {s.painel.leitura.alertas[0].slice(0, 160)}
          </p>
        )}
        {s.painel.situacao === "erro" && (
          <p className="mt-1 text-[12.5px] leading-snug text-ambar">
            Nenhum dos métodos de leitura conseguiu ler o painel da APPA agora. O radar segue com a API
            da previsão e tenta de novo no próximo ciclo. Detalhes:{" "}
            {(s.painel.erro ?? "").replace(/^Nenhum método conseguiu ler o painel da APPA — /, "")}
          </p>
        )}
        {s.painel.log.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[12px] font-bold text-[#8fd6ff]">
              Log de diagnóstico ({s.painel.log.length} {s.painel.log.length === 1 ? "linha" : "linhas"})
            </summary>
            <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-black/30 p-2 text-[11px] leading-snug text-gelo/80">
              {s.painel.log.slice(-12).join("\n")}
            </pre>
          </details>
        )}
      </div>

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
              s.fontes.composio ? "Composio (tempo atual)" : null,
              s.fontes.painel ? `Painel da APPA (${s.painel.metodoRotulo ?? "lido"})` : null,
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

      {s.composio && s.composioErro && (
        <p className="mt-2 rounded-[12px] bg-ambar/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-ambar">
          A segunda opinião do Composio (medição do tempo atual) não veio agora: {s.composioErro}. O
          radar segue sem ela.
        </p>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void verificarAgora()}
          disabled={rodando || lendo}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-[#38b6ff]/60 bg-[#0e2c63]/80 px-3 py-2.5 font-display text-[13px] font-bold tracking-wide text-[#8fd6ff] uppercase disabled:opacity-60"
        >
          <RefreshCw size={16} className={rodando ? "animate-spin" : ""} />
          {rodando ? "Verificando…" : "Verificar agora"}
        </button>
        <button
          type="button"
          onClick={() => void lerPainelAgora()}
          disabled={rodando || lendo}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-[#38b6ff]/60 bg-[#0e2c63]/80 px-3 py-2.5 font-display text-[13px] font-bold tracking-wide text-[#8fd6ff] uppercase disabled:opacity-60"
        >
          <ScanSearch size={16} className={lendo ? "animate-pulse" : ""} />
          {lendo ? "Lendo…" : "Ler painel agora"}
        </button>
      </div>
      {aviso && <p className="mt-2 px-0.5 text-[12.5px] text-[#8fd6ff]">{aviso}</p>}
    </section>
  );
}
