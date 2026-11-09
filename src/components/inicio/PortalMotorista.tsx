"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";

/**
 * PORTAL DO MOTORISTA — cadastro do PRÓPRIO CPF e senha do
 * `portal.copadubo.com.br`, dentro do aplicativo.
 *
 * Por que aqui: o portal é o site da Copadubo; o app não tem como "ver" a
 * página do motorista sem alguém entrar. Quem entra é o PRÓPRIO motorista,
 * digitando o CPF e a senha dele neste aparelho UMA vez. O servidor cifra os
 * dois (AES-256-GCM), usa só para abrir a página de status e apagar tudo é um
 * toque (DELETE /api/portal).
 *
 * O que o servidor devolve para a tela (e o que NUNCA devolve):
 *   volta: CPF mascarado (***.***.789-01), últimos 4 da senha, quantas linhas
 *          foram lidas, as linhas de interesse e o diagnóstico;
 *   nunca: o CPF completo, a senha, cookies ou o HTML da página.
 */

type Leitura = {
  ok: boolean;
  loginRecusado: boolean;
  captcha: boolean;
  titulo: string | null;
  totalLinhas: number;
  sinais: string[];
  quando: string | null;
  diagnostico: string | null;
};

export type EstadoPortalMotorista = {
  cadastrado: boolean;
  cpfMascarado: string | null;
  senhaFinal4: string | null;
  ativo: boolean;
  desde: string | null;
  leitura: Leitura | null;
};

type Estado = EstadoPortalMotorista;

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const inputBase =
  "w-full rounded-[14px] border-[1.5px] border-[#183341]/70 bg-[#071A28]/85 px-3.5 py-3 text-[15px] text-white outline-none transition-colors placeholder:text-gelo/40 focus:border-ciano/70";

export default function PortalMotorista({
  onFechar,
  inicial = null,
}: {
  onFechar: () => void;
  /** Estado já carregado pelo app ao abrir a tela (evita piscar "nada cadastrado"). */
  inicial?: Estado | null;
}) {
  const [estado, setEstado] = useState<Estado | null>(inicial);
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const [editando, setEditando] = useState(false);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/portal", { cache: "no-store" });
    if (!r.ok) return;
    const dados = (await r.json().catch(() => null)) as Estado | null;
    if (dados) setEstado(dados);
  }, []);

  useEffect(() => {
    // Sem o estado inicial (abertura direta), preenche enquanto este componente
    // espera (diferido): nada de setState síncrono dentro do efeito.
    if (estado) return;
    const t = setTimeout(() => void carregar(), 0);
    return () => clearTimeout(t);
  }, [estado, carregar]);

  async function salvar() {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    const r = await fetch("/api/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cpf, senha }),
    });
    const dados = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso({ texto: dados?.erro ?? "Não foi possível salvar agora.", erro: true });
      return;
    }
    // O que ficou guardado neste aparelho: nenhuma credencial em memória.
    setSenha("");
    setCpf("");
    setEditando(false);
    setAviso({ texto: dados?.mensagem ?? "Dados guardados.", erro: Boolean(dados?.leitura?.loginRecusado) });
    await carregar();
  }

  async function lerAgora() {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    const r = await fetch("/api/portal", { method: "PUT" });
    const dados = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso({ texto: dados?.erro ?? "A leitura falhou.", erro: true });
      return;
    }
    setAviso({
      texto: dados?.loginRecusado
        ? "O portal recusou o CPF/senha. Cadastre a senha de novo."
        : dados?.ok
          ? `Portal lido agora: ${dados?.linhas ?? 0} linha(s).`
          : "O portal não devolveu conteúdo nesta leitura.",
      erro: !dados?.ok,
    });
    await carregar();
  }

  async function apagar() {
    if (ocupado) return;
    setOcupado(true);
    // O botão aparece 2× (o primeiro toque pede confirmação).
    if (!confirmandoSaida) {
      setConfirmandoSaida(true);
      setOcupado(false);
      return;
    }
    await fetch("/api/portal", { method: "DELETE" });
    setOcupado(false);
    setConfirmandoSaida(false);
    setEstado(null);
    setAviso({ texto: "CPF, senha e histórico foram apagados deste aplicativo.", erro: false });
    await carregar();
  }

  const cadastrado = Boolean(estado?.cadastrado);
  const mostrarFormulario = !cadastrado || editando;
  const l = estado?.leitura ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-abismo/80 p-3 backdrop-blur-md sm:items-center">
      <div className="vidro largura-aparelho max-h-[92dvh] overflow-y-auto rounded-[30px] p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ciano/40 bg-ciano/10 text-ciano">
            <KeyRound size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[19px] leading-tight font-extrabold text-white">
              Portal do motorista
            </h2>
            <p className="mt-0.5 text-[12.5px] text-gelo/65">
              portal.copadubo.com.br · leitura dos seus dados
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gelo/20 text-gelo/80 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-3 text-[13.5px] leading-snug text-gelo/80">
          Digite aqui o <b>seu CPF e a senha do portal</b> uma única vez. O aplicativo
          entra no portal por você e avisa no celular quando algo mudar na sua página
          (chamada, fila, status).
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-[16px] border border-[#183341]/60 bg-[#071A28]/70 p-3">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#00B8BC]" />
          <p className="text-[12px] leading-snug text-gelo/70">
            CPF e senha ficam <b>cifrados no servidor</b> e só são usados para abrir a
            sua página no portal. Nunca aparecem na tela, em avisos nem para outros
            motoristas. Você pode apagar tudo quando quiser.
          </p>
        </div>

        {mostrarFormulario ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-gelo/85">
                CPF (o mesmo do login do portal)
              </span>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                inputMode="numeric"
                autoComplete="username"
                placeholder="000.000.000-00"
                className={inputBase}
                maxLength={20}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-gelo/85">
                Senha do portal
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  type={verSenha ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  className={inputBase}
                  maxLength={120}
                />
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  className="shrink-0 rounded-full border border-gelo/25 px-3 py-2.5 text-[12px] font-semibold text-gelo/80"
                >
                  {verSenha ? "Ocultar" : "Ver"}
                </button>
              </div>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={ocupado || !cpf.trim() || !senha.trim()}
                className="pill flex min-h-11 flex-1 items-center justify-center gap-2 bg-ciano px-4 py-2.5 font-display text-[14px] font-bold text-fundo uppercase disabled:opacity-50"
              >
                {ocupado ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {ocupado ? "Conferindo no portal…" : "Salvar e ler o portal"}
              </button>
              {cadastrado && (
                <button
                  type="button"
                  onClick={() => {
                    setEditando(false);
                    setSenha("");
                    setCpf("");
                  }}
                  className="pill px-4 py-2.5 text-[13px] font-semibold text-gelo/80"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-[16px] border border-[#183341]/60 bg-[#071A28]/70 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gelo/85">
                <span>
                  CPF <b className="text-white">{estado?.cpfMascarado}</b>
                </span>
                <span>
                  senha <b className="text-white">••••{estado?.senhaFinal4}</b>
                </span>
                <span className={estado?.ativo ? "text-ciano" : "text-red-300"}>
                  {estado?.ativo ? "monitorando" : "pausado"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-gelo/55">
                Cadastrado em {quando(estado?.desde ?? null)}. O servidor relê o portal
                a cada 5 minutos (e o app avisa quando muda).
              </p>
            </div>

            <div className="rounded-[16px] border border-[#183341]/60 bg-[#071A28]/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="micro text-gelo/55">Última leitura</span>
                <span className="text-[12px] text-gelo/70">{quando(l?.quando ?? null)}</span>
              </div>
              <p className="mt-1 text-[13px] text-gelo/85">
                {!l
                  ? "Ainda não houve leitura."
                  : l.loginRecusado
                    ? "O portal recusou o CPF/senha — cadastre a senha de novo."
                    : l.captcha
                      ? "O portal pediu captcha; a leitura automática está parada."
                      : l.ok
                        ? `${l.totalLinhas} linha(s) na página${l.titulo ? ` · ${l.titulo}` : ""}`
                        : "A última leitura não trouxe conteúdo."}
              </p>
              {l?.sinais?.length ? (
                <ul className="mt-2 space-y-1">
                  {l.sinais.slice(0, 6).map((s, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] text-gelo/80">
                      <span className="text-ciano">•</span>
                      <span className="min-w-0">{s}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void lerAgora()}
                disabled={ocupado}
                className="pill flex min-h-11 items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-gelo disabled:opacity-50"
              >
                {ocupado ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Ler agora
              </button>
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="pill flex min-h-11 items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-gelo"
              >
                <KeyRound size={15} /> Trocar CPF/senha
              </button>
              <button
                type="button"
                onClick={() => void apagar()}
                disabled={ocupado}
                className={`pill flex min-h-11 items-center gap-2 px-4 py-2.5 text-[13px] font-semibold ${
                  confirmandoSaida ? "border-red-400/60 text-red-200" : "text-gelo/80"
                }`}
              >
                <Trash2 size={15} />
                {confirmandoSaida ? "Confirmar: apagar tudo" : "Apagar meus dados"}
              </button>
            </div>
          </div>
        )}

        {aviso && (
          <p
            role="status"
            className={`mt-3 rounded-[14px] border px-3 py-2 text-[12.5px] leading-snug ${
              aviso.erro ? "border-red-400/50 text-red-200" : "border-ciano/40 text-ciano"
            }`}
          >
            {aviso.texto}
          </p>
        )}

        <p className="mt-3 text-[11px] leading-snug text-gelo/45">
          O portal é da Copadubo; o CopaLinks apenas abre a sua página com os seus
          dados e mostra o que aparece nela. Se a Copadubo mudar o site, a leitura é
          refeita sozinha — você não precisa atualizar nada.
        </p>
      </div>
    </div>
  );
}
