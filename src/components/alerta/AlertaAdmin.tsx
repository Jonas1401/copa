"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Megaphone } from "lucide-react";
import { garantirAssinaturaPush, temSuportePush } from "@/lib/push-cliente";

type Alerta = { id: number; mensagem: string; adminNome: string; criadoEm: string };
type Situacao = "normal" | "negado" | "sem_suporte";

const FUSO = "America/Sao_Paulo";
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO });

function ehIphone() {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Alerta individual enviado pelo administrador. Tela cheia, sem botão de
 * fechar: só some quando o motorista ativa as notificações neste aparelho
 * (o servidor confere a inscrição antes de aceitar).
 *
 * Exceção: aparelho que não suporta notificações (ex.: iPhone sem o app na
 * Tela de Início). Aí mostra como instalar e permite "Fechar por agora" — o
 * alerta continua pendente e volta na próxima abertura do app.
 */
export default function AlertaAdmin({ motoristaId, onAtivada }: { motoristaId: number; onAtivada?: () => void }) {
  const [alerta, setAlerta] = useState<Alerta | null>(null);
  const [adiado, setAdiado] = useState<number | null>(null);
  const [situacao, setSituacao] = useState<Situacao>("normal");
  const [ativando, setAtivando] = useState(false);
  const [erro, setErro] = useState("");
  const [concluido, setConcluido] = useState(false);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch("/api/motoristas/alerta", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setAlerta(d.alerta ?? null);
    } catch {
      /* tenta de novo depois */
    }
  }, []);

  // Confere ao abrir, a cada 1 minuto e sempre que o app volta para a tela.
  useEffect(() => {
    void buscar();
    const t = setInterval(() => { if (document.visibilityState === "visible") void buscar(); }, 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void buscar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [buscar, motoristaId]);

  useEffect(() => {
    if (!alerta) return;
    if (!temSuportePush()) setSituacao("sem_suporte");
    else if (Notification.permission === "denied") setSituacao("negado");
    else setSituacao("normal");
  }, [alerta]);

  async function ativar() {
    if (!alerta) return;
    setAtivando(true);
    setErro("");
    try {
      if (!temSuportePush()) { setSituacao("sem_suporte"); return; }
      const permissao = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permissao !== "granted") { setSituacao("negado"); return; }
      const assinatura = await garantirAssinaturaPush(motoristaId);
      const r = await fetch("/api/motoristas/alerta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: alerta.id, endpoint: assinatura.endpoint }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok || r.status === 404) {
        onAtivada?.();
        setConcluido(true);
        setTimeout(() => { setAlerta(null); setConcluido(false); }, 1800);
      } else {
        setErro(d.erro ?? "Não foi possível confirmar. Tente de novo.");
      }
    } catch {
      setErro("Não foi possível ativar agora. Confira a internet e tente de novo.");
    } finally {
      setAtivando(false);
    }
  }

  if (!alerta || adiado === alerta.id) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alerta-admin-titulo"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-abismo/90 p-4 backdrop-blur-md"
    >
      <div className="vidro w-full max-w-[400px] rounded-[30px] border border-ambar/50 p-6 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ambar/15 text-ambar shadow-[0_0_30px_-6px_rgba(255,190,60,0.7)]">
          <Megaphone size={30} />
        </span>
        <h2 id="alerta-admin-titulo" className="mt-4 font-display text-[21px] font-extrabold text-white">
          Aviso do administrador
        </h2>
        <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-wrap text-gelo">{alerta.mensagem}</p>
        <p className="mt-2 text-[12px] text-gelo/50">{alerta.adminNome} · {quando(alerta.criadoEm)}</p>

        {concluido ? (
          <p className="mt-6 rounded-2xl border border-verde/50 bg-verde/10 px-4 py-3 font-bold text-verde" role="status">
            ✔ Notificações ativadas. Obrigado!
          </p>
        ) : (
          <>
            {situacao === "negado" && (
              <div className="mt-5 rounded-2xl border border-ambar/40 bg-black/30 px-4 py-3 text-left text-[14px] leading-relaxed text-gelo/90">
                <b className="text-ambar">As notificações estão bloqueadas neste celular.</b>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                  <li>Toque no cadeado 🔒 ao lado do endereço (ou em ⋮ → Configurações do site).</li>
                  <li>Em <b>Notificações</b>, escolha <b>Permitir</b>.</li>
                  <li>Volte aqui e toque em <b>Ativar notificações</b>.</li>
                </ol>
                <p className="mt-1.5 text-[12.5px] text-gelo/60">No app instalado: Configurações do Android → Apps → CopaLinks → Notificações → Permitir.</p>
              </div>
            )}
            {situacao === "sem_suporte" && (
              <div className="mt-5 rounded-2xl border border-ambar/40 bg-black/30 px-4 py-3 text-left text-[14px] leading-relaxed text-gelo/90">
                <b className="text-ambar">Este navegador não recebe notificações.</b>
                {ehIphone() ? (
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                    <li>Abra o CopaLinks no <b>Safari</b>.</li>
                    <li>Toque em <b>Compartilhar</b> ⬆️ → <b>Adicionar à Tela de Início</b>.</li>
                    <li>Abra pelo ícone novo e toque em <b>Ativar notificações</b>.</li>
                  </ol>
                ) : (
                  <p className="mt-1.5">Abra o CopaLinks no <b>Google Chrome</b> e toque em <b>Ativar notificações</b>.</p>
                )}
              </div>
            )}

            {erro && <p className="mt-4 text-[14px] text-ambar" role="alert">{erro}</p>}

            <button
              type="button"
              onClick={() => void ativar()}
              disabled={ativando}
              className="ouro mt-6 flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 font-display text-[16px] font-extrabold uppercase disabled:opacity-60"
            >
              {ativando ? <Loader2 size={19} className="animate-spin" /> : <BellRing size={19} />}
              {situacao === "negado" ? "Já liberei, ativar notificações" : "Ativar notificações"}
            </button>
            {situacao === "sem_suporte" ? (
              <button
                type="button"
                onClick={() => setAdiado(alerta.id)}
                className="mt-3 w-full rounded-full px-5 py-2.5 text-[14px] text-gelo/60 underline-offset-2 hover:underline"
              >
                Fechar por agora (o aviso volta na próxima abertura)
              </button>
            ) : (
              <p className="mt-3 text-[12.5px] text-gelo/55">Este aviso só fecha depois de ativar as notificações.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
