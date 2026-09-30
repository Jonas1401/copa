"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, RotateCw, TriangleAlert } from "lucide-react";
import TesteAppFechado from "@/components/notificacoes/TesteAppFechado";

/**
 * Card NOTIFICAÇÕES dentro do painel do administrador — o mesmo card da aba
 * Sobre do app: ativar, testar na hora e testar com o app fechado.
 *
 * O aparelho do administrador se inscreve sem motorista vinculado: recebe os
 * avisos gerais do monitoramento (chamadas, saídas, testes).
 */

/** A chave pública VAPID vem do servidor em base64url: vira bytes p/ o browser. */
function chaveUint8(chave: string) {
  const base = chave.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base);
  const saida = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
  return saida;
}

const temSuporte = () =>
  typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export default function CartaoNotificacoesAdmin() {
  const [assinada, setAssinada] = useState<boolean | null>(null);
  const [ativando, setAtivando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgErro, setMsgErro] = useState(false);

  /** Registra o SW, cria/confirma a Push Subscription e envia ao backend. */
  const obterAssinatura = useCallback(async (): Promise<PushSubscription> => {
    const chave = await fetch("/api/push/chave", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (!chave?.publicKey) throw new Error("VAPID indisponível no servidor.");

    const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    const existente = await registro.pushManager.getSubscription();
    const assinatura =
      existente ??
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveUint8(chave.publicKey),
      }));

    await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: assinatura.toJSON(),
        dispositivo: navigator.userAgent.slice(0, 160),
        motoristaId: null, // aparelho do administrador: sem motorista vinculado
      }),
    });
    setAssinada(true);
    return assinatura;
  }, []);

  // Ao abrir o painel: este aparelho já está inscrito?
  useEffect(() => {
    if (!temSuporte() || Notification.permission !== "granted") {
      setAssinada(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const registro = await navigator.serviceWorker.getRegistration("/");
        const assinatura = await registro?.pushManager.getSubscription();
        if (vivo) setAssinada(Boolean(assinatura));
      } catch {
        if (vivo) setAssinada(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function ativar() {
    setMsg(null);
    setMsgErro(false);
    if (!temSuporte()) {
      setMsg("Este navegador não suporta notificações.");
      setMsgErro(true);
      return;
    }
    setAtivando(true);
    try {
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          setMsg("Permissão negada: permita as notificações nas configurações do navegador.");
          setMsgErro(true);
          return;
        }
      }
      await obterAssinatura();
      setMsg("🟢 Notificações ativadas neste aparelho.");
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : "Não foi possível ativar."}`);
      setMsgErro(true);
    } finally {
      setAtivando(false);
    }
  }

  async function testarAgora() {
    setMsg(null);
    setMsgErro(false);
    if (!temSuporte()) {
      setMsg("Este navegador não suporta notificações.");
      setMsgErro(true);
      return;
    }
    setTestando(true);
    try {
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          setMsg("Permissão negada: a notificação não pode ser enviada.");
          setMsgErro(true);
          return;
        }
      }
      const assinatura = await obterAssinatura();
      const r = await fetch("/api/push/teste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: assinatura.endpoint }),
      });
      const dados = await r.json().catch(() => ({}));
      if (dados.erro) {
        setMsg(`⚠️ ${dados.erro}`);
        setMsgErro(true);
      } else {
        setMsg(`🚀 Web Push enviado: ${dados.enviadas}/${dados.assinaturas} notificação(ões) real(is) pelo Chrome.`);
      }
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : "Falha ao enviar o teste."}`);
      setMsgErro(true);
    } finally {
      setTestando(false);
    }
  }

  return (
    <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
      <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-white uppercase">
        <BellRing size={22} className="text-ouro" /> Notificações
      </h2>
      <p className="mt-1 text-[14px] leading-relaxed text-gelo/80">
        {assinada === null
          ? "Verificando este aparelho…"
          : assinada
            ? "Este aparelho está recebendo os avisos."
            : "Ative para receber aviso quando um número for chamado."}
      </p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => void ativar()}
          disabled={ativando || testando}
          className="ouro flex items-center gap-2 rounded-full px-5 py-3 font-display text-[15px] font-extrabold uppercase disabled:opacity-60"
        >
          <Bell size={16} /> {ativando ? "Ativando…" : "Ativar notificações"}
        </button>
        <button
          type="button"
          onClick={() => void testarAgora()}
          disabled={ativando || testando}
          className="pill flex items-center gap-2 px-5 py-3 font-display text-[15px] font-bold text-ciano uppercase hover:border-ciano/60 disabled:opacity-60"
        >
          <RotateCw size={15} className={testando ? "animate-spin" : ""} />
          {testando ? "Enviando…" : "Testar notificação"}
        </button>
      </div>

      {msg && (
        <p
          className={`mt-3 flex gap-2 rounded-2xl border border-gelo/12 bg-black/30 px-4 py-3 text-[14px] leading-relaxed ${msgErro ? "text-[#ff9c9c]" : "text-ciano"}`}
        >
          {msgErro && <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
          <span>{msg}</span>
        </p>
      )}

      <TesteAppFechado obterAssinatura={obterAssinatura} />
    </section>
  );
}
