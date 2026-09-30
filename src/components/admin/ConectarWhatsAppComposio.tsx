"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

type Resposta<T> = { ok: boolean; status: number; dados: T };
type ApiAdmin = <T>(url: string, init?: RequestInit) => Promise<Resposta<T>>;
type Estado = { configurado: boolean; conectado: boolean; pendente: boolean; totalContas: number };
type Vinculo = { url?: string; expiraEm?: string | null; erro?: string };

/** A autenticação ocorre no Composio/Meta; nunca recebemos a senha da Meta. */
export default function ConectarWhatsAppComposio({
  api,
  onSessaoExpirada,
}: {
  api: ApiAdmin;
  onSessaoExpirada: (status: number) => boolean;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [erro, setErro] = useState("");

  const atualizar = useCallback(async () => {
    try {
      const r = await api<Estado & { erro?: string }>("/api/admin/whatsapp-composio");
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) {
        setErro(r.dados.erro ?? "Falha ao conferir a conta WhatsApp no Composio.");
        return;
      }
      setErro("");
      setEstado(r.dados);
      if (r.dados.conectado) setVinculo(null);
    } catch {
      setErro("Sem conexão com o Composio. Tente atualizar em instantes.");
    }
  }, [api, onSessaoExpirada]);

  useEffect(() => {
    void atualizar();
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    // Enquanto a pessoa finaliza a autorização em outra aba, atualiza só
    // de tempos em tempos; não cria novos links nem faz envio de mensagem.
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && vinculo) void atualizar();
    }, 15_000);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      clearInterval(t);
    };
  }, [atualizar, vinculo]);

  async function conectar() {
    setCarregando(true);
    setErro("");
    try {
      const r = await api<Vinculo>("/api/admin/whatsapp-composio", { method: "POST" });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok || !r.dados.url) {
        setErro(r.dados.erro ?? "Não foi possível preparar o link da Meta.");
        return;
      }
      setVinculo(r.dados);
      void atualizar();
    } catch {
      setErro("Sem conexão. Tente gerar o link novamente.");
    } finally {
      setCarregando(false);
    }
  }

  const expirou = vinculo?.expiraEm ? Date.now() > new Date(vinculo.expiraEm).getTime() : false;

  return (
    <div className="mt-4 rounded-[16px] border border-[#25d366]/35 bg-[#061b2a]/80 p-3.5 text-[13px] leading-relaxed text-gelo/85">
      <h3 className="font-display text-[14px] font-bold text-white">Via Composio · WhatsApp Business</h3>
      <p className="mt-1">
        Acesso à API oficial da Meta. Precisa de uma <b>conta WhatsApp Business (WABA)</b> — não é o mesmo que
        adicionar um número em Contatos Operacionais nem conecta o WhatsApp pessoal.
      </p>
      <p className={`mt-2 font-semibold ${estado?.conectado ? "text-[#62e7a0]" : "text-gelo/70"}`}>
        {estado?.conectado
          ? `● Conta empresarial conectada (${estado.totalContas} ativa${estado.totalContas === 1 ? "" : "s"})`
          : estado?.configurado === false
            ? "Composio sem chave configurada. Configure primeiro o card Composio."
            : estado?.pendente
              ? "● Autorização iniciada; conclua o login da Meta no link abaixo."
              : estado
                ? "○ WhatsApp Business ainda não conectado."
                : "Conferindo conta no Composio…"}
      </p>
      {erro && <p role="alert" className="mt-2 text-red-300">{erro}</p>}
      {!estado?.conectado && estado?.configurado && (
        <>
          <p className="mt-2 text-gelo/70">
            Para autorizar, é necessário o <b>WABA ID</b> (ID da conta empresarial, não o número de telefone).
            Consulte Meta Business Suite → Configurações → Contas → Contas do WhatsApp. O Composio pede esse ID
            na própria página segura de conexão.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void conectar()}
              disabled={carregando}
              className="rounded-full bg-[#25d366] px-4 py-2 font-display font-bold text-[#062b14] disabled:opacity-50"
            >
              {carregando ? "Preparando…" : vinculo ? "Gerar outro link" : "Conectar via Composio"}
            </button>
            {vinculo?.url && !expirou && (
              <a
                href={vinculo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#25d366]/65 px-4 py-2 font-bold text-[#62e7a0]"
              >
                Autorizar na Meta <ExternalLink size={15} />
              </a>
            )}
          </div>
          {expirou && <p className="mt-2 text-ambar">O link venceu. Gere outro link para continuar.</p>}
        </>
      )}
      <button
        type="button"
        onClick={() => void atualizar()}
        className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#a9e6c5] hover:underline"
      >
        <RefreshCw size={13} /> Atualizar estado da conexão
      </button>
      <p className="mt-2 text-[11.5px] text-gelo/55">
        Conectar não envia mensagens. Mensagens automáticas exigem consentimento dos destinatários e, fora da
        janela de atendimento de 24 horas, modelos aprovados pela Meta.
      </p>
    </div>
  );
}
