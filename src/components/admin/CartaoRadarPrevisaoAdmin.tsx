"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Radar, RefreshCw } from "lucide-react";

/**
 * Situação do RADAR DA PREVISÃO (monitoramento constante do tempo) — exclusivo
 * da ÁREA DO ADMINISTRADOR (`/admin`).
 *
 * O radar roda no servidor (`/api/cron`, a cada minuto): relê o SIMPORT®/APPA
 * pela API e o painel público da APPA com **fallback automático** — API/JSON,
 * HTTP + HTML, navegador headless (Playwright), captura de tela + OCR e, por
 * último, o Composio. Quando um método não consegue ler, o próximo entra
 * sozinho: a tela mostra "Painel APPA: conectado · leitura realizada" com o
 * MÉTODO que funcionou e só exibe erro quando TODOS falharam.
 *
 * O cartão também mostra o log de diagnóstico da última rodada (uma linha por
 * método tentado, com o motivo da falha) e a última leitura no formato único
 * (`DadosPainelAppa`): chuva, chuva forte, tempestade, vento, umidade, pressão
 * e alertas.
 *
 * O radar vigia SÓ a previsão — próximas horas e próximos dias — e só fala
 * quando ela traz CHUVA, NEBLINA forte ou TEMPESTADE: aí entra no chat e
 * chega como notificação (Web Push do Chrome), mesmo com o aplicativo
 * fechado. Previsão de tempo bom não gera mensagem nem notificação.
 */

export type TentativaPainel = {
  metodo: string;
  rotulo: string;
  ordem: number;
  ok: boolean;
  em: string;
  ms: number;
  motivo: string;
  caracteres: number;
  detalhe?: string;
};

export type LeituraPainel = {
  fonte: "APPA";
  timestamp_leitura: string;
  temperatura: string;
  chuva: string;
  chuva_forte: string;
  tempestade: string;
  vento: string;
  umidade: string;
  pressao: string;
  previsao: { hora: string; texto: string }[];
  alertas: string[];
  status: "sucesso" | "falha";
  metodo_leitura: string | null;
  atualizado_em: string | null;
};

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
  painel: {
    conectado: boolean;
    em: string | null;
    metodo: string | null;
    metodoRotulo: string | null;
    erro: string | null;
    tentativas: TentativaPainel[];
    leitura: LeituraPainel | null;
    resumo: string | null;
  };
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
  const [aberto, setAberto] = useState(false);
  const [s, setS] = useState<StatusRadar | null>(inicial ?? null);
  const [rodando, setRodando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [detalhes, setDetalhes] = useState(false);

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

  const ligado = s?.ativo ?? false;
  const conectado = s?.painel.conectado ?? false;
  const leitura = s?.painel.leitura ?? null;
  return (
    <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
            <Radar size={22} strokeWidth={2.2} /> Radar da previsão
            {s && (
              <span
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 font-sans text-[12px] font-bold normal-case ${
                  ligado ? "bg-verde/20 text-verde" : "bg-gelo/15 text-gelo/70"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${ligado ? "bg-verde" : "bg-gelo/50"}`} />
                {ligado ? "Monitorando" : "Desligado"}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-gelo/60">
            Monitoramento da previsão (próximas horas e próximos dias): avisa chuva, neblina forte e
            tempestade — tempo bom fica em silêncio
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gelo/70">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-[#2a5bb0]/35 pt-3">
          {!s ? (
            <p className="text-[14px] text-gelo/60">Carregando situação do radar…</p>
          ) : (
            <>
              <p className="px-0.5 text-[13.5px] leading-snug text-gelo/85">
                O CopaLinks acompanha a previsão do SIMPORT® – Dashboard Meteoceanográfico da APPA a cada{" "}
                <b className="text-white">{s.intervaloMin} minutos</b>, com o painel relido a cada{" "}
                <b className="text-white">{s.painelMin} minutos</b> por leitura automática (API → HTML →
                navegador → OCR → Composio). O radar vigia <b className="text-white">só a previsão</b> — próximas
                horas e próximos dias: quando ela traz <b className="text-white">chuva, neblina forte ou
                tempestade</b>, o aviso entra no chat e chega como notificação, mesmo com o aplicativo fechado.{" "}
                <b className="text-white">Tempo bom na previsão não gera mensagem nem notificação.</b>
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
                      s.fontes.estacao ? "Estação do porto" : null,
                      s.fontes.painel ? "Painel da APPA" : null,
                      s.fontes.composio ? "Composio (tempo atual)" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "aguardando a próxima leitura"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-gelo/70">Avisos em 24 h</dt>
                  <dd className="text-white">{s.mudancas24h}</dd>
                </div>

                {/* ------------------------------- painel da APPA: conectado ou não */}
                <div className="flex gap-2">
                  <dt className="shrink-0 text-gelo/70">Painel APPA</dt>
                  <dd className="min-w-0">
                    {conectado ? (
                      <span className="font-bold text-verde">
                        conectado · leitura realizada
                        {s.painel.em ? <span className="font-normal text-gelo/70"> em {horaMin(s.painel.em)}</span> : null}
                      </span>
                    ) : s.painel.erro ? (
                      <span className="text-ambar">sem leitura agora</span>
                    ) : (
                      <span className="text-gelo/70">aguardando a primeira leitura</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-gelo/70">Método de leitura</dt>
                  <dd className="min-w-0 text-white">
                    {conectado ? (
                      <>
                        <b>{s.painel.metodoRotulo ?? "leitura automática"}</b>
                        {s.painel.tentativas.filter((t) => !t.ok).length > 0 ? (
                          <span className="text-gelo/60">
                            {" "}
                            ({s.painel.tentativas.filter((t) => !t.ok).length} método(s) tentado(s) antes)
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "nenhum método conseguiu ler ainda"
                    )}
                  </dd>
                </div>

                {/* ------------------------------ última leitura no formato único */}
                {leitura && leitura.status === "sucesso" && (
                  <>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gelo/70">Chuva</dt>
                      <dd className="min-w-0 text-white">{leitura.chuva}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gelo/70">Chuva forte</dt>
                      <dd className="min-w-0 text-white">{leitura.chuva_forte}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gelo/70">Tempestade</dt>
                      <dd className="min-w-0 text-white">{leitura.tempestade}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gelo/70">Vento</dt>
                      <dd className="min-w-0 text-white">{leitura.vento}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gelo/70">Temperatura</dt>
                      <dd className="min-w-0 text-white">
                        {leitura.temperatura} · umidade {leitura.umidade} · pressão {leitura.pressao}
                      </dd>
                    </div>
                    {leitura.alertas.length > 0 && (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-gelo/70">Alertas do painel</dt>
                        <dd className="min-w-0 text-ambar">{leitura.alertas.join(" · ")}</dd>
                      </div>
                    )}
                    {leitura.atualizado_em && (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-gelo/70">Atualização do painel</dt>
                        <dd className="min-w-0 text-white">{leitura.atualizado_em}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>

              {/* --------------------------------- log de diagnóstico (tentativas) */}
              {s.painel.tentativas.length > 0 && (
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={() => setDetalhes((v) => !v)}
                    className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#8fd6ff]"
                  >
                    {detalhes ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    Log de diagnóstico da leitura ({s.painel.tentativas.filter((t) => t.ok).length} de{" "}
                    {s.painel.tentativas.length} método(s) com sucesso)
                  </button>
                  {detalhes && (
                    <ul className="mt-1.5 space-y-1 rounded-[12px] bg-[#04102a] px-2.5 py-2 text-[12px] leading-snug">
                      {s.painel.tentativas.map((t) => (
                        <li key={`${t.metodo}-${t.ordem}`} className="flex gap-1.5">
                          <span className={t.ok ? "text-verde" : "text-ambar"}>{t.ok ? "✓" : "✗"}</span>
                          <span className="min-w-0 text-gelo/85">
                            <b className="text-white">
                              {t.ordem}. {t.rotulo}
                            </b>{" "}
                            — {t.motivo}
                            <span className="text-gelo/50"> ({Math.round(t.ms)} ms)</span>
                            {t.detalhe ? <span className="text-gelo/50"> · {t.detalhe}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Erro SÓ quando todos os métodos falharam (nenhum "não lido pelo Composio"). */}
              {s.painel.erro && !conectado && (
                <p className="mt-2 rounded-[12px] bg-ambar/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-ambar">
                  Nenhum dos {s.painel.tentativas.length || 5} métodos conseguiu ler o painel da APPA agora:{" "}
                  {s.painel.erro} O radar continua com a API da Simport e com a medição do tempo atual.
                </p>
              )}
              {s.painel.erro && conectado && (
                <p className="mt-2 rounded-[12px] bg-ambar/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-ambar">
                  A última tentativa não conseguiu reler o painel ({s.painel.erro}); vale a última leitura
                  guardada, de {s.painel.em ? horaMin(s.painel.em) : "antes"}.
                </p>
              )}
              {!s.composio && (
                <p className="mt-2 rounded-[12px] bg-gelo/10 px-2.5 py-1.5 text-[12.5px] leading-snug text-gelo/75">
                  O Composio é opcional: sem a chave, a leitura do painel usa API/JSON, HTTP + HTML,
                  navegador automático e OCR. Cadastre em <b>/admin → Integrações</b> só se quiser o método
                  extra.
                </p>
              )}
              {s.composio && s.composioErro && (
                <p className="mt-2 rounded-[12px] bg-ambar/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-ambar">
                  O Composio não devolveu a medição do tempo agora: {s.composioErro}. O radar segue com a
                  estação da APPA.
                </p>
              )}

              <button
                type="button"
                onClick={() => void verificarAgora()}
                disabled={rodando}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-[#38b6ff]/60 bg-[#0e2c63]/80 px-4 py-2.5 font-display text-[14px] font-bold tracking-wide text-[#8fd6ff] uppercase disabled:opacity-60"
              >
                <RefreshCw size={16} className={rodando ? "animate-spin" : ""} />
                {rodando ? "Verificando…" : "Verificar agora"}
              </button>
              {aviso && <p className="mt-2 px-0.5 text-[12.5px] text-[#8fd6ff]">{aviso}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
