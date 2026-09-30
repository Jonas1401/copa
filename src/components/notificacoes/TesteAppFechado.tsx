"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CircleCheck, Hourglass, LoaderCircle, TriangleAlert } from "lucide-react";

type Resultado = "aguardando" | "enviando" | "enviado" | "falhou" | "sem_inscricao" | "expirado";
type Teste = {
  id: number;
  pedidoEm: string;
  enviarApos: string;
  processadoEm: string | null;
  resultado: Resultado;
};
type Resposta = { teste?: Teste | null; agora?: string; erro?: string };

/** Ao reabrir o app, mostra o resultado de testes pedidos nos últimos 30 min. */
const MOSTRAR_RECENTE_MS = 30 * 60_000;
/** Pendente mais que isso depois do horário mínimo = o ciclo do servidor não rodou. */
const ATRASO_MS = 100_000;

const hora = (iso: string, segundos = true) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    ...(segundos ? { second: "2-digit" as const } : {}),
  });

/** O ciclo de leitura do servidor roda no começo de cada minuto. */
const previsao = (enviarApos: string) =>
  new Date(Math.ceil(new Date(enviarApos).getTime() / 60_000) * 60_000).toISOString();

const temSuporte = () =>
  typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

async function chamar(corpo: Record<string, unknown>) {
  const r = await fetch("/api/push/teste-fechado", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(corpo),
  });
  const dados = (await r.json().catch(() => ({}))) as Resposta;
  return { ok: r.ok, dados };
}

/**
 * Botão "Testar com o app fechado": agenda o teste no servidor e quem envia
 * a notificação é o próximo ciclo de leitura (/api/cron) — o mesmo caminho
 * dos avisos de chamada quando o app está fechado.
 */
export default function TesteAppFechado({
  obterAssinatura,
  onPermissaoNegada,
}: {
  /** Registra o service worker e devolve a inscrição deste aparelho. */
  obterAssinatura: () => Promise<PushSubscription>;
  onPermissaoNegada?: () => void;
}) {
  const [teste, setTeste] = useState<Teste | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [, setTique] = useState(0);
  const endpointRef = useRef<string | null>(null);
  // Diferença entre o relógio do servidor e o do celular (evita erro de horário).
  const desvioRef = useRef(0);

  const agoraServidor = () => Date.now() + desvioRef.current;

  const aplicar = useCallback((dados: Resposta, soRecente: boolean) => {
    if (dados.agora) desvioRef.current = new Date(dados.agora).getTime() - Date.now();
    const t = dados.teste ?? null;
    if (t && soRecente && Date.now() + desvioRef.current - new Date(t.pedidoEm).getTime() > MOSTRAR_RECENTE_MS) {
      return;
    }
    setTeste(t);
  }, []);

  const consultar = useCallback(
    async (soRecente = false) => {
      const endpoint = endpointRef.current;
      if (!endpoint) return;
      try {
        const { ok, dados } = await chamar({ endpoint, acao: "status" });
        if (ok) aplicar(dados, soRecente);
      } catch {
        // sem rede: tenta de novo no próximo ciclo
      }
    },
    [aplicar],
  );

  // Ao abrir o app: se este aparelho pediu um teste há pouco, mostra o resultado.
  useEffect(() => {
    if (!temSuporte() || Notification.permission !== "granted") return;
    let vivo = true;
    (async () => {
      try {
        const registro = await navigator.serviceWorker.getRegistration("/");
        const assinatura = await registro?.pushManager.getSubscription();
        if (!vivo || !assinatura) return;
        endpointRef.current = assinatura.endpoint;
        await consultar(true);
      } catch {
        // sem service worker ainda: nada a mostrar
      }
    })();
    return () => {
      vivo = false;
    };
  }, [consultar]);

  const pendente = teste?.resultado === "aguardando" || teste?.resultado === "enviando";

  // Enquanto aguarda: confere a cada 5 s (só com a tela visível) e ao voltar ao app.
  useEffect(() => {
    if (!pendente) return;
    const intervalo = setInterval(() => {
      setTique((n) => n + 1);
      if (document.visibilityState === "visible") void consultar();
    }, 5_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void consultar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [pendente, consultar]);

  const testar = useCallback(async () => {
    setErro(null);
    if (!temSuporte()) {
      setErro("Este navegador não suporta notificações.");
      return;
    }
    setOcupado(true);
    try {
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          onPermissaoNegada?.();
          setErro("Permissão negada: ative as notificações para fazer o teste.");
          return;
        }
      }
      const assinatura = await obterAssinatura();
      endpointRef.current = assinatura.endpoint;
      const { ok, dados } = await chamar({ endpoint: assinatura.endpoint });
      if (!ok || !dados.teste) {
        setErro(dados.erro ?? "Não consegui agendar o teste. Tente de novo.");
        return;
      }
      aplicar(dados, false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui agendar o teste.");
    } finally {
      setOcupado(false);
    }
  }, [aplicar, obterAssinatura, onPermissaoNegada]);

  const atrasado =
    pendente && teste ? agoraServidor() - new Date(teste.enviarApos).getTime() > ATRASO_MS : false;

  let aviso: React.ReactNode = null;
  if (teste && pendente && !atrasado) {
    aviso = (
      <div className="text-gelo/90">
        <p className="flex items-center gap-2 font-bold text-ouro">
          <Hourglass size={16} className="shrink-0" /> Teste marcado! Agora feche o app.
        </p>
        <p className="mt-1.5">
          Arraste o CopaLinks para fora da tela de apps abertos (ou bloqueie o celular). No próximo
          ciclo de leitura do servidor — por volta das <b className="text-white">{hora(previsao(teste.enviarApos), false)}</b>{" "}
          — a notificação chega sozinha, com a posição do seu ponto.
        </p>
      </div>
    );
  } else if (teste && atrasado) {
    aviso = (
      <p className="flex gap-2 text-[#ffd84d]">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        Passou do horário e o servidor ainda não fez o ciclo de leitura. O vigia automático pode estar
        parado — avise o administrador.
      </p>
    );
  } else if (teste?.resultado === "enviado" && teste.processadoEm) {
    aviso = (
      <div>
        <p className="flex gap-2 font-bold text-[#7dffb0]">
          <CircleCheck size={16} className="mt-0.5 shrink-0" />
          O servidor enviou às {hora(teste.processadoEm)}, no ciclo de leitura, sem o app aberto.
        </p>
        <p className="mt-1.5 text-gelo/85">
          Se a notificação apareceu no celular, está tudo funcionando! Não apareceu? No Android: Configurações
          → Apps → Chrome → Bateria → <b className="text-white">Sem restrições</b>, e deixe as notificações do
          Chrome e deste site permitidas.
        </p>
      </div>
    );
  } else if (teste?.resultado === "sem_inscricao") {
    aviso = (
      <p className="flex gap-2 text-[#ff9c9c]">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        Este aparelho não está mais inscrito para receber avisos. Toque em Ativar notificações e teste de novo.
      </p>
    );
  } else if (teste?.resultado === "falhou") {
    aviso = (
      <p className="flex gap-2 text-[#ff9c9c]">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        O servidor tentou enviar{teste.processadoEm ? ` às ${hora(teste.processadoEm)}` : ""}, mas o serviço de
        notificações recusou. Tente de novo.
      </p>
    );
  } else if (teste?.resultado === "expirado") {
    aviso = (
      <p className="flex gap-2 text-[#ffd84d]">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        O teste não foi enviado a tempo: o ciclo de leitura do servidor não rodou. Tente de novo mais tarde.
      </p>
    );
  }

  return (
    <div className="mt-5 border-t border-gelo/10 pt-4">
      <p className="font-display text-[15px] font-extrabold tracking-[0.03em] text-white uppercase">
        Teste com o app fechado
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-gelo/80">
        Confere o caminho real dos avisos: você fecha o app e o servidor manda a notificação no próximo ciclo
        de leitura (em até 1 minuto e meio).
      </p>
      <button
        type="button"
        onClick={testar}
        disabled={ocupado || (pendente && !atrasado)}
        className="pill mt-3 flex items-center gap-2 px-5 py-3 font-display text-[15px] font-bold text-ouro uppercase hover:border-ouro/60 disabled:opacity-60"
      >
        {ocupado ? <LoaderCircle size={15} className="animate-spin" /> : <BellRing size={15} />}
        {pendente && !atrasado ? "Aguardando o ciclo…" : "Testar com o app fechado"}
      </button>
      {(erro || aviso) && (
        <div className="mt-3 rounded-2xl border border-gelo/12 bg-black/30 px-4 py-3 text-[14px] leading-relaxed">
          {erro ? (
            <p className="flex gap-2 text-[#ff9c9c]">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {erro}
            </p>
          ) : (
            aviso
          )}
        </div>
      )}
    </div>
  );
}
