"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CartaoNotificacoesAdmin from "@/components/admin/CartaoNotificacoesAdmin";
import CartaoMotoristasAdmin from "@/components/admin/CartaoMotoristasAdmin";
import {
  BellRing,
  Bot,
  ChevronLeft,
  CloudSun,
  Database,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LogOut,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

/* ---------------------------------------------------------------- tipos */
type Status = "conectado" | "erro" | "nao_configurado" | "nao_testado";

type CampoEstado = {
  chave: string;
  rotulo: string;
  secreto: boolean;
  dica?: string;
  opcoes?: { valor: string; rotulo: string }[];
  valorPublico?: string;
  info: {
    configurado: boolean;
    final4: string | null;
    origem: "painel" | "ambiente" | null;
    atualizadoEm: string | null;
  };
};

type Integracao = {
  id: string;
  nome: string;
  descricao: string;
  status: Status;
  mensagem: string;
  verificadoEm: string | null;
  configurada: boolean;
  campos: CampoEstado[];
  detalhes: { rotulo: string; valor: string }[];
  podeSalvar: boolean;
  podeRemover: boolean;
  rotuloSalvar: string;
  rotuloTestar: string;
};

type Admin = { id: number; nome: string; usuario: string };
type Registro = { id: number; admin: string; integracao: string; acao: string; detalhe: string; criadoEm: string };

/* ------------------------------------------------------------- visuais */
const ICONES: Record<string, typeof Plug> = {
  composio: Plug,
  clima: CloudSun,
  ia: Bot,
  notificacoes: BellRing,
  banco: Database,
};

const COR_ICONE: Record<string, string> = {
  composio: "bg-[#8b3dff]",
  clima: "bg-[#2f8cf0]",
  ia: "bg-[#e8892d]",
  notificacoes: "bg-[#e63950]",
  banco: "bg-[#1aa6b8]",
};

const STATUS: Record<Status, { rotulo: string; ponto: string; texto: string; borda: string }> = {
  conectado: { rotulo: "Conectado", ponto: "bg-verde shadow-[0_0_10px_#35e08a]", texto: "text-verde", borda: "border-verde/45" },
  erro: { rotulo: "Erro", ponto: "bg-red-500 shadow-[0_0_10px_#ef4444]", texto: "text-red-400", borda: "border-red-500/45" },
  nao_configurado: { rotulo: "Não configurado", ponto: "bg-ambar shadow-[0_0_10px_#f5b21e]", texto: "text-ambar", borda: "border-ambar/45" },
  nao_testado: { rotulo: "Não testado", ponto: "bg-azulclaro", texto: "text-azulclaro", borda: "border-[#2a5bb0]/60" },
};

const MASCARA = "••••••••••••";

const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : "—";

const ehIso = (v: string) => /^\d{4}-\d{2}-\d{2}T/.test(v);

const NOMES_INTEGRACAO: Record<string, string> = {
  composio: "Composio",
  clima: "Previsão do Tempo APPA",
  whatsapp: "WhatsApp",
  ia: "IA",
  notificacoes: "Notificações",
  banco: "Banco de dados",
  acesso: "Acesso",
};

/**
 * Token da sessão desta aba. Vai no header de cada chamada, para a sessão
 * continuar mesmo quando o navegador bloqueia o cookie (app aberto dentro de
 * outra página). Some ao fechar a aba ou ao sair.
 */
const CHAVE_TOKEN = "copalinks-admin-sessao";
let tokenSessao: string | null = null;

function lerToken() {
  if (tokenSessao) return tokenSessao;
  try {
    // Tenta primeiro localStorage (persistente no celular e PWA)
    tokenSessao = localStorage.getItem(CHAVE_TOKEN);
    if (!tokenSessao) {
      tokenSessao = sessionStorage.getItem(CHAVE_TOKEN);
    }
  } catch {
    tokenSessao = null;
  }
  return tokenSessao;
}

function guardarToken(t: string | null) {
  tokenSessao = t;
  try {
    if (t) {
      localStorage.setItem(CHAVE_TOKEN, t);
      sessionStorage.setItem(CHAVE_TOKEN, t);
    } else {
      localStorage.removeItem(CHAVE_TOKEN);
      sessionStorage.removeItem(CHAVE_TOKEN);
    }
  } catch {
    /* sem armazenamento: fica só na memória */
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; dados: T }> {
  const token = lerToken();
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const dados = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, dados: dados as T };
}

/* -------------------------------------------------------------- campos */
const inputBase =
  "w-full rounded-[14px] border-[1.5px] border-[#2a5bb0]/70 bg-[#06122b]/85 px-3.5 py-2.5 text-[15px] text-white outline-none transition-colors placeholder:text-gelo/40 focus:border-ciano/70";

function CampoSecreto({
  campo,
  valor,
  onValor,
}: {
  campo: CampoEstado;
  valor: string;
  onValor: (v: string) => void;
}) {
  const [ver, setVer] = useState(false);
  const { info } = campo;

  if (campo.opcoes) {
    return (
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-semibold text-gelo/85">{campo.rotulo}</span>
        <select
          className={inputBase}
          value={valor || campo.valorPublico || "auto"}
          onChange={(e) => onValor(e.target.value)}
        >
          {campo.opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[12.5px] font-semibold text-gelo/85">{campo.rotulo}</span>
        <code className="rounded-md bg-black/30 px-1.5 py-0.5 text-[10.5px] text-gelo/60">{campo.chave}</code>
      </div>

      {info.configurado && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-[#2a5bb0]/50 bg-black/25 px-3 py-2">
          <KeyRound size={14} className="text-azulclaro" />
          <span className="tabular font-mono text-[14px] text-white">
            {campo.rotulo.includes("Key") || campo.rotulo.includes("Token") ? "Chave" : "Valor"}: {MASCARA}
            {info.final4}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
              info.origem === "painel" ? "bg-verde/15 text-verde" : "bg-azulclaro/15 text-azulclaro"
            }`}
          >
            {info.origem === "painel" ? "salva no painel" : "variável de ambiente"}
          </span>
          {info.atualizadoEm && <span className="text-[11px] text-gelo/55">{dataHora(info.atualizadoEm)}</span>}
        </div>
      )}

      <div className="relative">
        <input
          type={ver ? "text" : "password"}
          value={valor}
          onChange={(e) => onValor(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="off"
          aria-label={campo.rotulo}
          placeholder={info.configurado ? "Cole uma nova para substituir" : `Cole a ${campo.rotulo}`}
          className={`${inputBase} pr-11 font-mono`}
        />
        <button
          type="button"
          onClick={() => setVer((v) => !v)}
          aria-label={ver ? "Esconder o que foi digitado" : "Mostrar o que foi digitado"}
          className="absolute top-1/2 right-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-gelo/60 hover:text-white"
        >
          {ver ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {campo.dica && <p className="mt-1 text-[11.5px] text-gelo/55">{campo.dica}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- card */
function CardIntegracao({
  it,
  ocupado,
  onSalvar,
  onTestar,
  onRemover,
  onSessaoExpirada,
}: {
  it: Integracao;
  ocupado: string | null;
  onSalvar: (id: string, valores: Record<string, string>) => Promise<boolean>;
  onTestar: (id: string) => void;
  onRemover: (it: Integracao) => void;
  onSessaoExpirada: (status: number) => boolean;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const Icone = ICONES[it.id] ?? Plug;
  const st = STATUS[it.status];
  const temNoPainel = it.campos.some((c) => c.info.origem === "painel");
  const algoDigitado = Object.values(valores).some((v) => v.trim());
  const carregandoEste = ocupado?.startsWith(it.id);

  async function salvar() {
    const ok = await onSalvar(it.id, valores);
    if (ok) setValores({}); // não deixa a chave digitada na memória da tela
  }

  const final4Principal = it.campos.find((c) => c.secreto && c.info.configurado)?.info.final4;

  return (
    <section className={`rounded-[22px] border-[1.5px] bg-[linear-gradient(180deg,rgba(13,40,92,0.9),rgba(8,24,60,0.94))] p-4 ${st.borda}`}>
      <header className="flex items-start gap-3">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-white ${COR_ICONE[it.id]}`}>
          <Icone size={24} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[18px] leading-tight font-extrabold text-white">{it.nome}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-gelo/75">{it.descricao}</p>
        </div>
      </header>

      {/* resumo: chave mascarada + status */}
      <div className="mt-3 grid gap-1.5 rounded-[14px] border border-[#2a5bb0]/50 bg-[#06122b]/70 px-3.5 py-2.5 text-[13.5px]">
        {it.campos.some((c) => c.secreto) && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-gelo/70">API Key</span>
            <span className="tabular font-mono text-white">{final4Principal ? `${MASCARA}${final4Principal}` : "—"}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-gelo/70">Status</span>
          <span className={`flex items-center gap-2 font-bold ${st.texto}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${st.ponto}`} />
            {st.rotulo}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gelo/70">Última verificação</span>
          <span className="tabular text-white">{dataHora(it.verificadoEm)}</span>
        </div>
        {it.detalhes.map((d) => (
          <div key={d.rotulo} className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-gelo/70">{d.rotulo}</span>
            <span className="text-right text-white">{ehIso(d.valor) ? dataHora(d.valor) : d.valor}</span>
          </div>
        ))}
      </div>

      {it.mensagem && it.status !== "nao_configurado" && (
        <p className={`mt-2 text-[13px] leading-snug ${it.status === "erro" ? "text-red-300" : "text-gelo/80"}`}>{it.mensagem}</p>
      )}

      {it.podeSalvar && (
        <div className="mt-3 space-y-3">
          {it.campos.map((c) => (
            <CampoSecreto
              key={c.chave}
              campo={c}
              valor={valores[c.chave] ?? ""}
              onValor={(v) => setValores((s) => ({ ...s, [c.chave]: v }))}
            />
          ))}
        </div>
      )}

      {/* ações */}
      <div className="mt-4 flex flex-wrap gap-2">
        {it.podeSalvar && (
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!algoDigitado || Boolean(ocupado)}
            className="ouro flex items-center gap-2 rounded-full px-4 py-2.5 font-display text-[14px] font-extrabold uppercase disabled:opacity-45"
          >
            <Save size={16} /> {ocupado === `${it.id}:salvar` ? "Salvando…" : it.rotuloSalvar}
          </button>
        )}
        <button
          type="button"
          onClick={() => onTestar(it.id)}
          disabled={Boolean(ocupado) || (!it.configurada && it.campos.length > 0)}
          className="flex items-center gap-2 rounded-full border-[1.5px] border-ciano/55 px-4 py-2.5 font-display text-[14px] font-bold text-ciano uppercase hover:bg-ciano/10 disabled:opacity-45"
        >
          <RefreshCw size={16} className={ocupado === `${it.id}:testar` ? "animate-spin" : ""} />
          {ocupado === `${it.id}:testar` ? "Testando…" : it.rotuloTestar}
        </button>
        {it.podeRemover && temNoPainel && (
          <button
            type="button"
            onClick={() => onRemover(it)}
            disabled={Boolean(ocupado)}
            className="flex items-center gap-2 rounded-full border-[1.5px] border-red-500/55 px-4 py-2.5 font-display text-[14px] font-bold text-red-300 uppercase hover:bg-red-500/10 disabled:opacity-45"
          >
            <Trash2 size={16} /> Remover chave
          </button>
        )}
      </div>
      {carregandoEste && <span className="sr-only">Processando…</span>}
    </section>
  );
}

/* ------------------------------------------------------------ entrada */
function Entrada({
  modo,
  onEntrou,
}: {
  modo: "setup" | "login";
  onEntrou: (a: Admin) => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [recuperando, setRecuperando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (modo === "setup" && senha !== senha2) {
      setErro("As senhas não conferem.");
      return;
    }
    setEnviando(true);
    const r = await api<{ admin?: Admin; token?: string; erro?: string }>(modo === "setup" ? "/api/admin/setup" : "/api/admin/login", {
      method: "POST",
      body: JSON.stringify(modo === "setup" ? { codigo, nome, usuario, senha } : { usuario, senha }),
    });
    setEnviando(false);
    setSenha("");
    setSenha2("");
    if (r.ok && r.dados.admin) {
      guardarToken(r.dados.token ?? null);
      onEntrou(r.dados.admin);
    }
    else setErro(r.dados.erro ?? "Não foi possível entrar.");
  }

  if (modo === "login" && recuperando) {
    return (
      <RecuperarSenha
        usuarioInicial={usuario}
        onVoltar={() => setRecuperando(false)}
      />
    );
  }

  return (
    <form onSubmit={enviar} className="mx-auto mt-6 w-full max-w-[420px] rounded-[24px] border-[1.5px] border-[#2a5bb0]/60 bg-[linear-gradient(180deg,rgba(13,40,92,0.92),rgba(8,24,60,0.95))] p-5">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_24px_-4px_rgba(47,140,240,0.8)]">
        <ShieldCheck size={28} />
      </span>
      <h2 className="mt-3 font-display text-[22px] font-extrabold text-white">
        {modo === "setup" ? "Criar administrador" : "Acesso do administrador"}
      </h2>
      <p className="mt-1 text-[14px] leading-relaxed text-gelo/75">
        {modo === "setup"
          ? "Primeiro acesso: use o código de configuração para criar a conta de administrador."
          : "Área restrita. Entre com seu usuário e senha de administrador."}
      </p>

      <div className="mt-4 space-y-3">
        {modo === "setup" && (
          <>
            <input className={`${inputBase} font-mono uppercase`} placeholder="Código de configuração" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="one-time-code" aria-label="Código de configuração" />
            <input className={inputBase} placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" aria-label="Seu nome" />
          </>
        )}
        <input className={inputBase} placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="off" aria-label="Usuário" />
        <input className={inputBase} type="password" placeholder={modo === "setup" ? "Senha (mín. 8 caracteres)" : "Senha"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete={modo === "setup" ? "new-password" : "current-password"} aria-label="Senha" />
        {modo === "setup" && (
          <input className={inputBase} type="password" placeholder="Repita a senha" value={senha2} onChange={(e) => setSenha2(e.target.value)} autoComplete="new-password" aria-label="Repita a senha" />
        )}
      </div>

      {erro && <p className="mt-3 rounded-[12px] border border-red-500/50 bg-red-500/10 px-3 py-2 text-[13.5px] text-red-200">{erro}</p>}

      <button type="submit" disabled={enviando} className="ouro mt-4 flex h-[50px] w-full items-center justify-center rounded-full font-display text-[16px] font-extrabold uppercase disabled:opacity-50">
        {enviando ? "Aguarde…" : modo === "setup" ? "Criar e entrar" : "Entrar"}
      </button>
      {modo === "login" && (
        <button type="button" onClick={() => setRecuperando(true)} className="mt-2.5 w-full py-2 text-center text-[13.5px] font-semibold text-gelo/70 hover:text-white">
          Esqueci a senha
        </button>
      )}
    </form>
  );
}

/* ----------------------------------------------------- recuperar senha */
function RecuperarSenha({
  usuarioInicial,
  onVoltar,
}: {
  usuarioInicial: string;
  onVoltar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [usuario, setUsuario] = useState(usuarioInicial);
  const [nova, setNova] = useState("");
  const [nova2, setNova2] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setOk("");
    if (nova !== nova2) {
      setErro("As senhas novas não conferem.");
      return;
    }
    setEnviando(true);
    const r = await api<{ ok?: boolean; usuario?: string; erro?: string }>("/api/admin/recuperar", {
      method: "POST",
      body: JSON.stringify({ codigo, novaSenha: nova, usuario: usuario || undefined }),
    });
    setEnviando(false);
    setCodigo("");
    setNova("");
    setNova2("");
    if (r.ok) {
      setOk(`Senha de "${r.dados.usuario}" redefinida. Volte e entre com a nova senha.`);
    } else setErro(r.dados.erro ?? "Não foi possível redefinir a senha.");
  }

  return (
    <form onSubmit={enviar} className="mx-auto mt-6 w-full max-w-[420px] rounded-[24px] border-[1.5px] border-[#2a5bb0]/60 bg-[linear-gradient(180deg,rgba(13,40,92,0.92),rgba(8,24,60,0.95))] p-5">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_24px_-4px_rgba(47,140,240,0.8)]">
        <KeyRound size={28} />
      </span>
      <h2 className="mt-3 font-display text-[22px] font-extrabold text-white">Esqueci a senha</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-gelo/75">
        Use o código de configuração (de uso único) para definir uma nova senha.
      </p>
      <div className="mt-4 space-y-3">
        <input className={`${inputBase} font-mono uppercase`} placeholder="Código de configuração" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="one-time-code" aria-label="Código de configuração" />
        <input className={inputBase} placeholder="Usuário (se houver mais de um admin)" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="off" aria-label="Usuário" />
        <input className={inputBase} type="password" placeholder="Nova senha (mín. 8 caracteres)" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" aria-label="Nova senha" />
        <input className={inputBase} type="password" placeholder="Repita a nova senha" value={nova2} onChange={(e) => setNova2(e.target.value)} autoComplete="new-password" aria-label="Repita a nova senha" />
      </div>
      {erro && <p className="mt-3 rounded-[12px] border border-red-500/50 bg-red-500/10 px-3 py-2 text-[13.5px] text-red-200">{erro}</p>}
      {ok && <p className="mt-3 rounded-[12px] border border-verde/50 bg-verde/10 px-3 py-2 text-[13.5px] text-verde">{ok}</p>}
      <button type="submit" disabled={enviando} className="ouro mt-4 flex h-[50px] w-full items-center justify-center rounded-full font-display text-[16px] font-extrabold uppercase disabled:opacity-50">
        {enviando ? "Aguarde…" : "Redefinir senha"}
      </button>
      <button type="button" onClick={onVoltar} className="mt-2.5 w-full py-2 text-center text-[13.5px] font-semibold text-gelo/70 hover:text-white">
        ← Voltar ao login
      </button>
    </form>
  );
}

/* -------------------------------------------------------- trocar senha */
function TrocarSenha({
  onAviso,
  onSessaoExpirada,
}: {
  onAviso: (a: { texto: string; erro: boolean }) => void;
  onSessaoExpirada: (status: number) => boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [nova2, setNova2] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== nova2) {
      onAviso({ texto: "As senhas novas não conferem.", erro: true });
      return;
    }
    setEnviando(true);
    const r = await api<{ ok?: boolean; erro?: string }>("/api/admin/senha", {
      method: "POST",
      body: JSON.stringify({ atual, nova }),
    });
    setEnviando(false);
    if (onSessaoExpirada(r.status)) return;
    if (r.ok) {
      setAtual("");
      setNova("");
      setNova2("");
      setAberto(false);
      onAviso({ texto: "Senha trocada.", erro: false });
    } else onAviso({ texto: r.dados.erro ?? "Não foi possível trocar a senha.", erro: true });
  }

  return (
    <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
          <KeyRound size={22} /> Trocar senha
        </span>
        <span className="text-[13px] text-gelo/70">{aberto ? "Fechar" : "Abrir"}</span>
      </button>
      {aberto && (
        <form onSubmit={salvar} className="mt-3 grid gap-2.5 sm:grid-cols-3">
          <input className={inputBase} type="password" placeholder="Senha atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" aria-label="Senha atual" />
          <input className={inputBase} type="password" placeholder="Nova senha (mín. 8)" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" aria-label="Nova senha" />
          <input className={inputBase} type="password" placeholder="Repita a nova senha" value={nova2} onChange={(e) => setNova2(e.target.value)} autoComplete="new-password" aria-label="Repita a nova senha" />
          <button type="submit" disabled={enviando || !atual || nova.length < 8} className="ouro flex h-[46px] items-center justify-center rounded-full font-display text-[15px] font-extrabold uppercase disabled:opacity-45 sm:col-span-3">
            {enviando ? "Salvando…" : "Salvar nova senha"}
          </button>
        </form>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- app */
export default function AdminApp() {
  const [fase, setFase] = useState<"carregando" | "setup" | "login" | "painel">("carregando");
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [itens, setItens] = useState<Integracao[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const [remover, setRemover] = useState<Integracao | null>(null);

  const sair401 = useCallback((status: number) => {
    // Só desloga com "Sessão expirada" se realmente havia um token salvo que falhou
    if (status === 401 && lerToken()) {
      guardarToken(null);
      setAdmin(null);
      setFase("login");
      setAviso({ texto: "Sessão expirada. Entre novamente.", erro: true });
      return true;
    } else if (status === 401) {
      setAdmin(null);
      setFase("login");
      return true;
    }
    return false;
  }, []);

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      api<Integracao[]>("/api/admin/integracoes"),
      api<Registro[]>("/api/admin/auditoria"),
    ]);
    if (sair401(a.status)) return;
    if (a.ok) setItens(a.dados);
    if (b.ok) setRegistros(b.dados);
  }, [sair401]);

  useEffect(() => {
    void (async () => {
      const r = await api<{ logado: boolean; admin: Admin | null; precisaSetup: boolean }>("/api/admin/sessao");
      if (r.dados.logado && r.dados.admin) {
        setAdmin(r.dados.admin);
        setFase("painel");
      } else setFase(r.dados.precisaSetup ? "setup" : "login");
    })();
  }, []);

  useEffect(() => {
    if (fase === "painel") void carregar();
  }, [fase, carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function salvar(id: string, valores: Record<string, string>) {
    setOcupado(`${id}:salvar`);
    try {
      const r = await api<{ integracoes?: Integracao[]; teste?: { status: string; mensagem: string }; erro?: string }>(
        `/api/admin/integracoes/${id}`,
        { method: "PUT", body: JSON.stringify({ valores }) },
      );
      if (sair401(r.status)) return false;
      if (!r.ok) {
        setAviso({ texto: r.dados.erro ?? "Não foi possível salvar.", erro: true });
        return false;
      }
      if (r.dados.integracoes) setItens(r.dados.integracoes);
      setAviso({
        texto: `Salvo. ${r.dados.teste?.status === "conectado" ? "Conexão OK." : r.dados.teste?.mensagem ?? ""}`,
        erro: r.dados.teste?.status === "erro",
      });
      void carregar();
      return true;
    } finally {
      setOcupado(null);
    }
  }

  async function testar(id: string) {
    setOcupado(`${id}:testar`);
    try {
      let endpointAparelho: string | undefined;
      if (id === "notificacoes" && "serviceWorker" in navigator) {
        // Testa o envio real só para o aparelho do próprio administrador.
        const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        endpointAparelho = (await reg?.pushManager.getSubscription().catch(() => null))?.endpoint;
      }
      const r = await api<{ integracoes?: Integracao[]; teste?: { status: string; mensagem: string }; erro?: string }>(
        `/api/admin/integracoes/${id}/testar`,
        { method: "POST", body: JSON.stringify({ endpointAparelho }) },
      );
      if (sair401(r.status)) return;
      if (r.dados.integracoes) setItens(r.dados.integracoes);
      setAviso({ texto: r.dados.teste?.mensagem ?? r.dados.erro ?? "Teste concluído.", erro: r.dados.teste?.status !== "conectado" });
      void carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarRemocao() {
    if (!remover) return;
    const id = remover.id;
    setRemover(null);
    setOcupado(`${id}:remover`);
    try {
      const r = await api<{ integracoes?: Integracao[]; erro?: string }>(`/api/admin/integracoes/${id}`, { method: "DELETE" });
      if (sair401(r.status)) return;
      if (r.dados.integracoes) setItens(r.dados.integracoes);
      setAviso({ texto: r.ok ? "Chave removida." : r.dados.erro ?? "Não foi possível remover.", erro: !r.ok });
      void carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function sair() {
    await api("/api/admin/logout", { method: "POST" });
    guardarToken(null);
    setAdmin(null);
    setItens([]);
    setRegistros([]);
    setFase("login");
  }

  return (
    <div className="relative min-h-screen w-full bg-[#063a78]">

      <main className="relative mx-auto w-full max-w-[980px] px-3 pt-4 pb-12">
        <header className="flex items-center gap-3">
          <Link href="/" aria-label="Voltar ao início" className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 text-white hover:border-ciano/70 hover:text-ciano">
            <ChevronLeft size={26} strokeWidth={2.2} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[clamp(21px,6vw,30px)] leading-tight font-extrabold text-white">Configurações de API</h1>
            <p className="text-[13.5px] text-gelo/75">Gerencie as integrações externas utilizadas pelo CopaLinks.</p>
          </div>
          {admin && (
            <button type="button" onClick={() => void sair()} className="flex shrink-0 items-center gap-2 rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 px-3 py-2 text-[13px] font-semibold text-gelo hover:border-red-400/60 hover:text-red-300">
              <LogOut size={16} /> <span className="hidden sm:inline">{admin.nome.split(" ")[0]} ·</span> Sair
            </button>
          )}
        </header>

        {fase === "carregando" && <p className="mt-10 text-center text-[15px] text-gelo/70">Verificando acesso…</p>}
        {(fase === "setup" || fase === "login") && (
          <Entrada
            modo={fase}
            onEntrou={(a) => {
              setAdmin(a);
              setFase("painel");
            }}
          />
        )}

        {fase === "painel" && (
          <>
            {/* nome e pontos de todos os motoristas (só o administrador vê) */}
            <CartaoMotoristasAdmin api={api} onSessaoExpirada={sair401} />

            <Link href="/monitor" className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-ciano/45 bg-[#0b2146] p-4 transition-colors hover:border-ciano">
              <span>
                <span className="block font-display text-base font-bold text-white">Monitor WhatsApp</span>
                <span className="mt-1 block text-xs text-gelo/70">Parear Android monitor, acompanhar códigos e notificações FCM</span>
              </span>
              <span aria-hidden className="text-xl text-ciano">→</span>
            </Link>

            <p className="mt-4 flex items-start gap-2 rounded-[16px] border border-verde/35 bg-verde/[0.07] px-3.5 py-2.5 text-[13px] leading-snug text-gelo/85">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-verde" />
              As chaves ficam cifradas no servidor e nunca voltam para a tela: depois de salvas, só os 4 últimos caracteres aparecem. Os testes rodam no servidor.
            </p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {itens.length === 0 && <p className="text-[15px] text-gelo/70">Carregando integrações…</p>}
              {itens.map((it) => (
                <CardIntegracao key={it.id} it={it} ocupado={ocupado} onSalvar={salvar} onTestar={(id) => void testar(id)} onRemover={setRemover} onSessaoExpirada={sair401} />
              ))}
            </div>

            <CartaoNotificacoesAdmin />

            <TrocarSenha onAviso={setAviso} onSessaoExpirada={sair401} />

            <section className="mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4">
              <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#38b6ff] uppercase">
                <History size={22} /> Auditoria
              </h2>
              <p className="mt-0.5 text-[12.5px] text-gelo/60">Quem alterou o quê e quando. Valores de chave nunca são registrados.</p>
              <ul className="barra-rolagem mt-3 max-h-[380px] divide-y divide-[#2a5bb0]/35 overflow-y-auto">
                {registros.length === 0 && <li className="py-3 text-[14px] text-gelo/60">Nenhum registro ainda.</li>}
                {registros.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2.5 text-[13.5px]">
                    <span className="tabular shrink-0 text-[12px] text-gelo/55">{dataHora(r.criadoEm)}</span>
                    <b className="text-white">{r.admin}</b>
                    <span className="text-gelo/85">{r.acao}</span>
                    <span className="rounded-full bg-[#2f8cf0]/15 px-2 py-0.5 text-[11.5px] font-semibold text-azulclaro">
                      {NOMES_INTEGRACAO[r.integracao] ?? r.integracao}
                    </span>
                    {r.detalhe && <span className="w-full text-[12px] text-gelo/55">{r.detalhe}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      {/* confirmação de remoção */}
      <AnimatePresence>
        {remover && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
            onClick={(e) => e.target === e.currentTarget && setRemover(null)}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="titulo-remover"
              initial={{ y: 30 }}
              animate={{ y: 0 }}
              className="w-full max-w-[420px] rounded-[24px] border-[1.5px] border-red-500/50 bg-[linear-gradient(180deg,#1a1030,#0d0a22)] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-red-400">
                  <Trash2 size={24} />
                </span>
                <button type="button" onClick={() => setRemover(null)} aria-label="Fechar" className="text-gelo/60 hover:text-white">
                  <X size={22} />
                </button>
              </div>
              <h2 id="titulo-remover" className="mt-3 font-display text-[19px] leading-snug font-extrabold text-white">
                Tem certeza que deseja remover esta API Key?
              </h2>
              <p className="mt-1.5 text-[14px] text-gelo/80">Essa ação pode interromper a integração.</p>
              <p className="mt-1 text-[13px] text-gelo/60">Integração: {remover.nome}</p>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => setRemover(null)} autoFocus className="rounded-full border-[1.5px] border-[#2a5bb0]/70 py-3 font-display text-[15px] font-bold text-white uppercase hover:bg-white/5">
                  Cancelar
                </button>
                <button type="button" onClick={() => void confirmarRemocao()} className="rounded-full bg-red-500 py-3 font-display text-[15px] font-extrabold text-white uppercase hover:bg-red-600">
                  Remover
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {aviso && (
        <div role="status" className="fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
          <div className={`max-w-[520px] rounded-full border px-4 py-3 text-[14px] font-medium shadow-lg ${aviso.erro ? "border-red-400/50 bg-[#2a0f18] text-red-200" : "border-verde/50 bg-[#0b2a1f] text-verde"}`}>
            {aviso.texto}
          </div>
        </div>
      )}
    </div>
  );
}
