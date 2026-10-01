"use client";

import type { EstadoDTO, LinhaFila, PontoDTO } from "@/lib/estado";
import type { Servico } from "@/lib/servicos";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Crown,
  ExternalLink,
  MapPin,
  Truck,
  Users,
  Pencil,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Cabecalho from "@/components/inicio/Cabecalho";
import BannerCaminhao from "@/components/inicio/BannerCaminhao";
import Servicos from "@/components/inicio/Servicos";
import NavInferior, { type Aba } from "@/components/inicio/NavInferior";
import { garantirAssinaturaPush } from "@/lib/push-cliente";
import ChatMotoristas, { CHAVE_CHAT_LIDO } from "@/components/chat/ChatMotoristas";
import AlertaAdmin from "@/components/alerta/AlertaAdmin";
import BoasVindas, { type DadosBoasVindas } from "@/components/motoristas/BoasVindas";
import CarregamentoLogo from "@/components/inicio/CarregamentoLogo";
import { CHAVE_MOTORISTA, COOKIE_MOTORISTA, primeiroNome, type Motorista } from "@/lib/motoristas";
import { IMAGEM_COMPARTILHAR, NOME_APP, linkDoApp, mensagemCompartilhar } from "@/lib/compartilhar";
import { FUNDO } from "@/lib/fundo";
import { LOGO } from "@/lib/logo";


/* ------------------------------------------------------------------ base */

const ROTULO: Record<string, string> = {
  TRUCK: "TRUCK",
  CAVALO: "CAVALO/C",
};

const COR_TIPO: Record<string, string> = {
  TRUCK: "text-laranja border-laranja/55",
  CAVALO: "text-verde border-verde/55",
};

const pad = (n: number) => String(n).padStart(3, "0");

type DadosCadastro = { tipo: string; livro: string; numero: number };

function decorrido(iso: string, agora: number) {
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${m % 60}`;
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Led({
  cor = "verde",
  pulsante = false,
  tamanho,
}: {
  cor?: string;
  pulsante?: boolean;
  /** Diâmetro em px (padrão do CSS: 11 px). */
  tamanho?: number;
}) {
  return (
    <span
      className={`led led-${cor} ${pulsante ? "led-pulsante" : ""}`}
      style={tamanho ? { width: tamanho, height: tamanho } : undefined}
    />
  );
}

function BotaoIcone({
  children,
  onClick,
  rotulo,
  ativo = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  rotulo: string;
  ativo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors ${
        ativo
          ? "border-ciano/60 bg-ciano/15 text-ciano"
          : "border-gelo/20 bg-black/25 text-gelo/80 hover:border-ciano/60 hover:text-ciano"
      }`}
    >
      {children}
    </button>
  );
}

function Painel({
  titulo,
  corTitulo,
  acao,
  icone,
  children,
  className = "",
}: {
  titulo: string;
  corTitulo: string;
  acao?: React.ReactNode;
  icone?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`painel p-4 sm:p-5 ${className}`}>
      <header className="mb-3.5 flex items-center justify-between gap-3">
        <h2
          className={`flex items-center gap-3 font-display text-[clamp(17px,4.9vw,22px)] leading-[1.05] font-extrabold tracking-[0.01em] uppercase ${corTitulo}`}
        >
          {icone}
          {titulo}
        </h2>
        {acao}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------- seus pontos */

function LinhaPonto({
  p,
  editando,
  selecionado = false,
  onSelecionar,
  onSalvar,
  onRemover,
}: {
  p: PontoDTO;
  editando: boolean;
  selecionado?: boolean;
  onSelecionar?: () => void;
  onSalvar: (d: { tipo: string; livro: string; numero: number }) => void;
  onRemover: () => void;
}) {
  const [tipo, setTipo] = useState<string>(p.tipo);
  const [livro, setLivro] = useState<string>(p.livro);
  const [numero, setNumero] = useState(String(p.numero));
  const sujo =
    tipo !== p.tipo || livro !== p.livro || Number(numero) !== p.numero;
  const mini =
    "rounded-full border border-violeta/40 bg-black/35 px-3 py-1.5 font-display text-[14px] font-bold text-gelo outline-none";
  const cor = p.status === "AGUARDANDO" ? "verde" : "ambar";
  return (
    <li
      className={`rounded-[16px] border px-4 py-3 transition-colors ${
        selecionado
          ? "border-ciano/45 bg-ciano/[0.06]"
          : "border-[#1d4690]/45 bg-[#06122b]/55"
      }`}
    >
      <button
        type="button"
        onClick={onSelecionar}
        title="Mostrar este ponto no cartão"
        className="flex min-h-[40px] w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-display text-[19px] font-extrabold tracking-[0.02em] text-white">
            {p.tipo === "CAVALO" ? "CAVALO" : "TRUCK"}
          </span>
          <span className="text-aco">•</span>
          <span className="tabular font-display text-[19px] font-extrabold text-ciano">
            {p.codigo}
          </span>
          {p.status !== "SAIU" && (
            <span
              className={`tabular text-[13px] font-medium ${
                p.status === "NA VEZ" ? "text-ambar" : "text-verde"
              }`}
            >
              fila nº {p.posicao} ·{" "}
              {p.status === "NA VEZ" ? "na vez" : `${p.naFrente} na frente`}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Led cor={cor} pulsante={p.status === "NA VEZ"} />
          <span
            className={`font-display text-[15px] font-bold tracking-[0.06em] ${
              cor === "verde" ? "text-verde" : "text-ambar"
            }`}
          >
            {p.status}
          </span>
        </div>
      </button>

      {editando && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            className={mini}
            value={tipo}
            aria-label="Tipo do ponto"
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="TRUCK">TRUCK</option>
            <option value="CAVALO">CAVALO</option>
          </select>
          <select
            className={mini}
            value={livro}
            aria-label="Livro do ponto"
            onChange={(e) => setLivro(e.target.value)}
          >
            <option value="A">Livro A</option>
            <option value="B">Livro B</option>
            <option value="M">Livro M</option>
          </select>
          <input
            className={`${mini} tabular w-[68px] text-center`}
            inputMode="numeric"
            maxLength={3}
            aria-label="Número do ponto"
            value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
          />
          <button
            type="button"
            disabled={!sujo}
            onClick={() => onSalvar({ tipo, livro, numero: Number(numero) })}
            className="micro rounded-full border border-ciano/50 px-3 py-1.5 text-ciano enabled:hover:bg-ciano/15 disabled:opacity-35"
          >
            salvar
          </button>
          <button
            type="button"
            onClick={onRemover}
            className="micro ml-auto flex items-center gap-1.5 rounded-full border border-red-400/45 px-3 py-1.5 text-red-300 hover:bg-red-400/10"
          >
            <Trash2 size={12} /> remover
          </button>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------- painel de notificações */

function PainelNotificacoes({
  modo,
  ativas,
  assinada,
  ativando,
  resultado,
  onAtivar,
  onAlternarAlertas,
  onContinuar,
  onFechar,
}: {
  modo: "geral" | "pedir" | "negado" | "ativado" | "suporte";
  ativas: boolean;
  assinada: boolean;
  ativando: boolean;
  resultado: string | null;
  onAtivar: () => void;
  onAlternarAlertas: () => void;
  onContinuar: () => void;
  onFechar: () => void;
}) {
  const titulos: Record<string, string> = {
    geral: "🔔 Notificações",
    pedir: "🔔 Ative as notificações",
    negado: "🔴 Notificações não ativadas",
    ativado: "🟢 Notificações ativadas",
    suporte: "Notificações indisponíveis",
  };
  const textos: Record<string, string> = {
    geral: "Avisos quando o seu número for chamado na fila.",
    pedir:
      "Para receber um aviso quando seu número for chamado, permita as notificações do Monitor Ponto CopaLinks.",
    negado:
      "Para receber os avisos do monitoramento, permita as notificações nas configurações do navegador.",
    ativado: "Ponto cadastrado com sucesso.",
    suporte:
      "Este navegador não suporta Web Push. O cadastro do ponto continua normalmente.",
  };

  return (
    <div>
      <h2 className="font-display text-[23px] font-extrabold tracking-[0.02em] text-white uppercase">
        {titulos[modo]}
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-gelo/85">
        {textos[modo]}
      </p>

      {resultado && (
        <p className="mt-3 rounded-2xl border border-gelo/12 bg-black/30 px-4 py-3 text-[14px] text-ciano">
          {resultado}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2.5">
        {(modo === "pedir" || modo === "geral") && (
          <button
            type="button"
            onClick={onAtivar}
            disabled={ativando}
            className="ouro flex items-center gap-2 rounded-full px-5 py-3 font-display text-[15px] font-extrabold tracking-[0.03em] uppercase disabled:opacity-60"
          >
            <Bell size={16} /> {ativando ? "Ativando…" : "Ativar notificações"}
          </button>
        )}

        {modo === "geral" && (
          <button
            type="button"
            onClick={onAlternarAlertas}
            className="pill flex items-center gap-2 px-5 py-3 font-display text-[15px] font-bold tracking-[0.03em] text-gelo uppercase hover:border-ciano/60"
          >
            {ativas ? <BellOff size={15} /> : <Bell size={15} />}
            {ativas ? "Silenciar (Mudo)" : "Alertas Ativas"}
          </button>
        )}

        {modo === "negado" && (
          <button
            type="button"
            onClick={onContinuar}
            className="ouro flex items-center gap-2 rounded-full px-5 py-3 font-display text-[15px] font-extrabold tracking-[0.03em] uppercase"
          >
            Continuar sem notificações
          </button>
        )}

        {modo === "suporte" && (
          <button
            type="button"
            onClick={onContinuar}
            className="ouro flex items-center gap-2 rounded-full px-5 py-3 font-display text-[15px] font-extrabold tracking-[0.03em] uppercase"
          >
            Cadastrar mesmo assim
          </button>
        )}

        <button
          type="button"
          onClick={onFechar}
          className="pill flex items-center gap-2 px-5 py-3 font-display text-[15px] font-bold tracking-[0.03em] text-aco uppercase hover:border-ciano/60"
        >
          <X size={15} /> {modo === "pedir" ? "Agora não" : "Fechar"}
        </button>
      </div>

      <p className="micro mt-4 text-aco">
        {assinada ? "push subscription ativa" : "sem push subscription"} ·
        service worker registrado sob demanda
      </p>
    </div>
  );
}

/** Folha de "CADASTRAR PONTO": abre ao tocar no número do cartão. */
function FolhaCadastro({
  tipo,
  livro,
  numero,
  ocupado,
  onTipo,
  onLivro,
  onNumero,
  onConfirmar,
  onFechar,
}: {
  tipo: string;
  livro: string;
  numero: string;
  ocupado: boolean;
  onTipo: (v: string) => void;
  onLivro: (v: string) => void;
  onNumero: (v: string) => void;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => campo.current?.focus(), 250);
    const h = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", h);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", h);
    };
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-abismo/75 backdrop-blur-md sm:items-center sm:p-3"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cadastro"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.7, 0.3, 1] }}
        className="w-full max-w-[390px] rounded-t-[30px] border border-violeta/40 bg-[linear-gradient(180deg,#1c1240_0%,#120c2c_100%)] p-5 pb-8 shadow-[0_-20px_80px_-20px_rgba(185,140,245,0.45)] sm:rounded-[30px] sm:pb-6"
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gelo/20 sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2
            id="titulo-cadastro"
            className="font-display text-[24px] font-extrabold tracking-[0.02em] text-violeta uppercase"
          >
            Cadastrar ponto
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid h-10 w-10 place-items-center rounded-full border border-gelo/20 bg-black/30 text-gelo hover:border-violeta/60 hover:text-violeta"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[124px] flex-1">
            <span className="micro mb-2 block text-gelo/85">Tipo</span>
            <span className="relative block">
              <select
                className="campo"
                value={tipo}
                onChange={(e) => onTipo(e.target.value)}
              >
                <option value="TRUCK">TRUCK</option>
                <option value="CAVALO">CAVALO</option>
              </select>
              <ChevronDown
                size={18}
                className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-violeta"
              />
            </span>
          </label>

          <label className="min-w-[124px] flex-1">
            <span className="micro mb-2 block text-gelo/85">Livro</span>
            <span className="relative block">
              <select
                className="campo"
                value={livro}
                onChange={(e) => onLivro(e.target.value)}
              >
                <option value="A">Livro A</option>
                <option value="B">Livro B</option>
                <option value="M">Livro M</option>
              </select>
              <ChevronDown
                size={18}
                className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-violeta"
              />
            </span>
          </label>

          <label className="w-[104px]">
            <span className="micro mb-2 block text-gelo/85">Número</span>
            <input
              ref={campo}
              className="campo tabular text-center"
              inputMode="numeric"
              placeholder="025"
              value={numero}
              maxLength={3}
              onChange={(e) => onNumero(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && onConfirmar()}
            />
          </label>

          <button
            type="button"
            onClick={onConfirmar}
            disabled={ocupado}
            className="ouro flex h-[52px] min-w-[150px] flex-1 items-center justify-center gap-2 rounded-full font-display text-[17px] font-extrabold tracking-[0.03em] uppercase disabled:opacity-60"
          >
            <Plus size={20} strokeWidth={3} /> Confirmar
          </button>
        </div>
      </motion.section>
    </div>
  );
}

/** "há 12 min", "há 40 s", "há 1h05" */
function haQuanto(iso: string, agora: number) {
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Linha de informação: ícone em anel, texto e valor (com a seta à direita). */
function FaixaInfo({
  icone,
  anel,
  rotulo,
  destaque,
  valor,
  corValor,
  sub,
  divisor = false,
}: {
  icone: React.ReactNode;
  /** Cor do anel do ícone (borda + brilho). */
  anel: string;
  rotulo: string;
  destaque?: { texto: string; cor: string };
  valor: string;
  corValor: string;
  sub: string;
  /** Linha vertical antes do valor (usada em "Último escalado"). */
  divisor?: boolean;
}) {
  return (
    <div className="flex min-h-[67px] w-full items-center gap-3 rounded-[24px] border border-[#2a5bb0]/70 bg-[#0a2144]/85 py-2.5 pr-2.5 pl-3 text-left">
      <span
        className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full border-[1.5px] ${anel}`}
      >
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[14.5px] leading-tight font-extrabold text-white">
          {rotulo}
          {destaque && <span className={`ml-1 ${destaque.cor}`}>{destaque.texto}</span>}
        </span>
        <span className="mt-1 block text-[13px] leading-tight text-gelo/75">{sub}</span>
      </span>
      <span className={`flex shrink-0 items-center ${divisor ? "h-[35px] border-l border-gelo/25 pl-5" : ""}`}>
        <span
          className={`tabular font-display text-[clamp(24px,7.3vw,31px)] leading-none font-extrabold ${corValor}`}
        >
          {valor}
        </span>
        <ChevronRight
          aria-hidden
          size={22}
          strokeWidth={2.6}
          className="ml-1 shrink-0 text-gelo/70"
        />
      </span>
    </div>
  );
}

/** Painel CADASTRAR PONTO embutido (abre ao tocar no número do cartão). */
function CadastroInline({
  tipo,
  livro,
  numero,
  ocupado,
  onTipo,
  onLivro,
  onNumero,
  onConfirmar,
}: {
  tipo: string;
  livro: string;
  numero: string;
  ocupado: boolean;
  onTipo: (v: string) => void;
  onLivro: (v: string) => void;
  onNumero: (v: string) => void;
  onConfirmar: () => void;
}) {
  const campo =
    "w-full appearance-none rounded-full border-[1.5px] border-violeta/55 bg-[#0c0a24]/80 py-2.5 pr-8 pl-4 font-display text-[clamp(13px,3.9vw,16px)] font-extrabold tracking-[0.04em] text-white outline-none transition-colors focus:border-violeta";
  return (
    <section className="rounded-[24px] border-[1.5px] border-violeta/50 bg-[linear-gradient(180deg,rgba(40,22,86,0.9),rgba(22,14,56,0.92))] px-4 pt-3.5 pb-4 shadow-[0_0_50px_-18px_rgba(185,140,245,0.6)]">
      <h2 className="flex items-center gap-3 font-display text-[clamp(18px,5.2vw,23px)] font-extrabold tracking-[0.05em] text-violeta uppercase">
        <MapPin size={26} className="fill-violeta text-[#1c1240]" strokeWidth={2} />
        Cadastrar ponto
      </h2>

      <div className="mt-2.5 grid grid-cols-[1fr_1fr_0.8fr] gap-2 sm:grid-cols-[1fr_1fr_0.8fr_1.25fr]">
        <label className="min-w-0">
          <span className="mb-1.5 block font-display text-[12px] font-bold tracking-[0.1em] text-gelo/80 uppercase">
            Tipo
          </span>
          <span className="relative block">
            <select className={campo} value={tipo} onChange={(e) => onTipo(e.target.value)}>
              <option value="TRUCK">TRUCK</option>
              <option value="CAVALO">CAVALO</option>
            </select>
            <ChevronDown
              size={17}
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gelo/80"
            />
          </span>
        </label>

        <label className="min-w-0">
          <span className="mb-1.5 block font-display text-[12px] font-bold tracking-[0.1em] text-gelo/80 uppercase">
            Livro
          </span>
          <span className="relative block">
            <select className={campo} value={livro} onChange={(e) => onLivro(e.target.value)}>
              <option value="A">Livro A</option>
              <option value="B">Livro B</option>
              <option value="M">Livro M</option>
            </select>
            <ChevronDown
              size={17}
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gelo/80"
            />
          </span>
        </label>

        <label className="min-w-0">
          <span className="mb-1.5 block font-display text-[12px] font-bold tracking-[0.1em] text-gelo/80 uppercase">
            Número
          </span>
          <input
            className={`${campo} tabular !px-3 text-center placeholder:text-gelo/40`}
            inputMode="numeric"
            placeholder="025"
            value={numero}
            maxLength={3}
            aria-label="Número do ponto"
            onChange={(e) => onNumero(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && onConfirmar()}
          />
        </label>

        <button
          type="button"
          onClick={onConfirmar}
          disabled={ocupado}
          className="ouro col-span-3 flex h-[46px] items-center justify-center gap-2 self-end rounded-full font-display text-[16px] font-extrabold tracking-[0.05em] uppercase disabled:opacity-60 sm:col-span-1"
        >
          <Plus size={20} strokeWidth={3} /> Adicionar
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- app */

export default function MonitorApp({ inicial }: { inicial: EstadoDTO }) {
  const [estado, setEstado] = useState<EstadoDTO>(inicial);
  const [idx, setIdx] = useState(0);
  const [agora, setAgora] = useState(() => Date.now());
  // Diferença entre o relógio do servidor e o do celular (ms). Sem ela, um
  // celular com relógio atrasado mostrava "Atualizado há 0s" o tempo todo.
  const [desvioRelogio, setDesvioRelogio] = useState(0);
  useEffect(() => {
    const servidor = new Date(estado.servidorAgora ?? "").getTime();
    if (Number.isFinite(servidor)) setDesvioRelogio(servidor - Date.now());
  }, [estado.servidorAgora]);
  const [aba, setAba] = useState<Aba>("inicio");
  const [expandido, setExpandido] = useState(false);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [ativas, setAtivas] = useState(true);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(
    null,
  );
  const [tipo, setTipo] = useState("TRUCK");
  const [livro, setLivro] = useState("A");
  const [numero, setNumero] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [painelNotif, setPainelNotif] = useState<
    null | "geral" | "pedir" | "negado" | "ativado" | "suporte"
  >(null);
  const [pendente, setPendente] = useState<DadosCadastro | null>(null);
  const [ativando, setAtivando] = useState(false);
  const [assinada, setAssinada] = useState(false);
  const [teste, setTeste] = useState<string | null>(null);
  const reduzido = useReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrastou = useRef(false);

  // ------------------------------------------- motorista deste aparelho
  const [motorista, setMotorista] = useState<Motorista | null>(null);
  // Objeto estável para o chat e o assistente de IA. Antes era recriado a
  // cada segundo (relógio "Atualizado há…"), e o assistente recarregava a
  // conversa sem parar — a tela tremia.
  const motoristaId = motorista?.id ?? null;
  const motoristaNome = motorista?.nome ?? null;
  const motoristaChat = useMemo(
    () => (motoristaId !== null && motoristaNome !== null ? { id: motoristaId, nome: motoristaNome } : null),
    [motoristaId, motoristaNome],
  );
  const motoristaRef = useRef<Motorista | null>(null);
  const [perfilPronto, setPerfilPronto] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erroEntrada, setErroEntrada] = useState("");
  const [totalMotoristas, setTotalMotoristas] = useState<number | null>(null);
  const [chatAberto, setChatAberto] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const [editandoNome, setEditandoNome] = useState(false);
  const [novoNome, setNovoNome] = useState("");

  // Tela de carregamento com a logo: cobre a abertura até o perfil deste
  // aparelho ser confirmado (já vem desenhada do servidor, sem piscar).
  const [carregando, setCarregando] = useState(true);
  const terminarCarregamento = useCallback(() => setCarregando(false), []);

  // Notificação de mensagem do chat tocada: o Service Worker abre `/?chat=1`
  // e o app já entra direto na conversa (também ao "navegar" numa aba aberta).
  useEffect(() => {
    const abrirSePedido = () => {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("chat") !== "1") return;
        setChatAberto(true);
        url.searchParams.delete("chat");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      } catch {
        /* URL inválida: ignora */
      }
    };
    abrirSePedido();
    // Aba já aberta: o Service Worker manda { tipo: "abrir-chat" } ao tocar na
    // notificação; o pageshow cobre o retorno do cache do navegador (bfcache).
    const aoMensagemDoSW = (ev: MessageEvent) => {
      if (ev.data && ev.data.tipo === "abrir-chat") setChatAberto(true);
    };
    window.addEventListener("pageshow", abrirSePedido);
    navigator.serviceWorker?.addEventListener("message", aoMensagemDoSW);
    return () => {
      window.removeEventListener("pageshow", abrirSePedido);
      navigator.serviceWorker?.removeEventListener("message", aoMensagemDoSW);
    };
  }, []);

  const guardarMotorista = useCallback((m: Motorista | null) => {
    motoristaRef.current = m;
    setMotorista(m);
    try {
      if (m) localStorage.setItem(CHAVE_MOTORISTA, JSON.stringify(m));
      else localStorage.removeItem(CHAVE_MOTORISTA);
    } catch {
      /* navegador sem armazenamento: vale só nesta visita */
    }
    // Remove o cookie antigo com ID legível. A identidade agora é uma sessão
    // aleatória httpOnly, criada pelo servidor, não alterável pelo JavaScript.
    document.cookie = `${COOKIE_MOTORISTA}=; path=/; max-age=0; samesite=lax`;
  }, []);

  // Confere a identidade deste aparelho no servidor. Aparelhos que já tinham
  // perfil salvo antes da sessão segura podem vinculá-lo uma vez, sem perder o
  // número que cadastraram. Nunca confia apenas no ID do localStorage.
  useEffect(() => {
    let vivo = true;
    let salvo: Motorista | null = null;
    try {
      salvo = JSON.parse(localStorage.getItem(CHAVE_MOTORISTA) ?? "null");
    } catch {
      salvo = null;
    }
    document.cookie = `${COOKIE_MOTORISTA}=; path=/; max-age=0; samesite=lax`;
    void (async () => {
      try {
        let r = await fetch("/api/motoristas/sessao", { cache: "no-store" });
        if (r.status === 401 && salvo?.id && salvo.criadoEm) {
          let assinatura: PushSubscriptionJSON | null = null;
          try {
            const registro = await navigator.serviceWorker?.getRegistration("/");
            assinatura = (await registro?.pushManager.getSubscription())?.toJSON() ?? null;
          } catch {
            // Funciona também se o aparelho nunca ativou as notificações.
          }
          r = await fetch("/api/motoristas/sessao", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: salvo.id, criadoEm: salvo.criadoEm, subscription: assinatura }),
          });
        }
        if (!vivo) return;
        if (r.ok) {
          guardarMotorista(await r.json());
          const estadoAtual = await fetch("/api/estado", { cache: "no-store" });
          if (vivo && estadoAtual.ok) setEstado(await estadoAtual.json());
        } else {
          motoristaRef.current = null;
          setMotorista(null);
          if (r.status === 403 || salvo?.id) {
            setErroEntrada("Não foi possível confirmar este perfil neste aparelho. Reabra no aparelho original.");
          }
        }
      } catch {
        if (vivo) {
          motoristaRef.current = null;
          setMotorista(null);
          setErroEntrada("Sem conexão. Confira a internet e tente abrir o app novamente.");
        }
      } finally {
        if (vivo) {
          setEstado((e) => motoristaRef.current ? e : { ...e, pontos: [], eventos: [] });
          setPerfilPronto(true);
        }
      }
    })();
    return () => { vivo = false; };
  }, [guardarMotorista]);

  // Chat: bolinha com as mensagens novas de outros motoristas.
  const marcarChatLido = useCallback((ultimoId: number) => {
    try {
      if (ultimoId > Number(localStorage.getItem(CHAVE_CHAT_LIDO) ?? 0)) {
        localStorage.setItem(CHAVE_CHAT_LIDO, String(ultimoId));
      }
    } catch {
      /* sem armazenamento */
    }
    setNaoLidas(0);
  }, []);

  useEffect(() => {
    if (chatAberto) return;
    const contar = async () => {
      try {
        const lido = Number(localStorage.getItem(CHAVE_CHAT_LIDO) ?? 0) || 0;
        const r = await fetch(`/api/chat?contar=${lido}&eu=${motoristaRef.current?.id ?? 0}`, { cache: "no-store" });
        if (r.ok) setNaoLidas((await r.json()).novas ?? 0);
      } catch {
        /* tenta de novo */
      }
    };
    void contar();
    const t = setInterval(() => void contar(), 20_000);
    return () => clearInterval(t);
  }, [chatAberto, motorista?.id]);

  // Contagem de motoristas (ícone "Sobre"): só o número, sem nomes.
  const carregarContagem = useCallback(async () => {
    try {
      const r = await fetch("/api/motoristas", { cache: "no-store" });
      if (r.ok) setTotalMotoristas((await r.json()).total ?? null);
    } catch {
      /* tenta de novo na próxima */
    }
  }, []);

  useEffect(() => {
    void carregarContagem();
    const t = setInterval(() => void carregarContagem(), 60_000);
    return () => clearInterval(t);
  }, [carregarContagem]);

  const total = estado.pontos.length;

  // Estado com SÓ os pontos do motorista deste aparelho. Se o motorista mudou
  // enquanto a resposta vinha, descarta (nunca mostra pontos de outro).
  const buscarEstado = useCallback(async () => {
    const id = motoristaRef.current?.id ?? 0;
    try {
      const r = await fetch("/api/estado", { cache: "no-store" });
      if (r.ok && (motoristaRef.current?.id ?? 0) === id) setEstado(await r.json());
    } catch {
      /* próxima varredura */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    // Primeira varredura sai cedo; depois disso, uma a cada 5 segundos.
    const primeira = setTimeout(() => void buscarEstado(), 2200);
    timer.current = setInterval(() => void buscarEstado(), 5000);
    return () => {
      clearInterval(t);
      clearTimeout(primeira);
      if (timer.current) clearInterval(timer.current);
    };
  }, [buscarEstado]);

  // Motorista do aparelho definido ou trocado (cadastro, conferência): busca na hora.
  useEffect(() => {
    if (perfilPronto) void buscarEstado();
  }, [motorista?.id, perfilPronto, buscarEstado]);

  useEffect(() => {
    if (idx > 0 && idx >= total) setIdx(Math.max(0, total - 1));
  }, [total, idx]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3600);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [aba]);

  const atualizar = useCallback(async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/atualizar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motoristaRef.current?.id ?? null }),
      });
      if (r.ok) setEstado(await r.json());
      else setAviso({ texto: "Falha ao reler o monitor.", erro: true });
    } catch {
      setAviso({ texto: "Sem conexão com o monitor.", erro: true });
    } finally {
      setOcupado(false);
    }
  }, []);

  const salvar = useCallback(
    async (
      id: number,
      d: { tipo: string; livro: string; numero: number },
    ) => {
      const r = await fetch(`/api/pontos/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Só o dono corrige o próprio ponto.
        body: JSON.stringify({ ...d, motoristaId: motoristaRef.current?.id ?? null }),
      });
      const dados = await r.json();
      if (dados.estado) {
        setEstado(dados.estado);
        setAviso({ texto: "Ponto corrigido · varredura feita.", erro: false });
      }
      if (dados.erro) setAviso({ texto: dados.erro, erro: true });
    },
    [],
  );

  const remover = useCallback(async (id: number) => {
    // Só o dono remove o próprio ponto.
    const r = await fetch(`/api/pontos/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motoristaId: motoristaRef.current?.id ?? null }),
    });
    const dados = await r.json();
    if (dados.estado) {
      setEstado(dados.estado);
      setAviso({ texto: "Ponto removido do monitoramento.", erro: false });
    }
    if (dados.erro) setAviso({ texto: dados.erro, erro: true });
  }, []);

  // ------------------------------------------------------- cadastro
  const enviarCadastro = useCallback(
    async (dados: DadosCadastro, comAviso = true) => {
      const r = await fetch("/api/pontos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...dados,
          motoristaId: motoristaRef.current?.id ?? null,
        }),
      });
      const resposta = await r.json();
      if (resposta.estado) {
        setEstado(resposta.estado);
        setIdx(resposta.estado.pontos.length - 1);
        setNumero("");
        setCadastroAberto(false);
        if (comAviso) {
          setAviso({
            texto: `${dados.livro}${dados.numero} no monitoramento.`,
            erro: false,
          });
        }
        return true;
      }
      setAviso({
        texto: resposta.erro ?? "Não foi possível cadastrar.",
        erro: true,
      });
      return false;
    },
    [],
  );

  // ---------------------------------------------- web push (navegador)
  const temSuporte = () =>
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  /** Registra o SW, cria/confirma a Push Subscription e envia ao backend. */
  const garantirAssinatura = useCallback(async () => {
    // Liga o aparelho ao motorista: os avisos chegam com o nome dele.
    const assinatura = await garantirAssinaturaPush(motoristaRef.current?.id ?? null);
    setAssinada(true);
    return assinatura;
  }, []);

  // Os testes de notificação (imediato e com o app fechado) ficam no painel
  // do administrador (/admin → Notificações).

  /**
   * CONFIRMAR: primeiro confere o estado das notificações; a autorização
   * (e a Push Subscription) vêm antes de concluir o cadastro do ponto.
   */
  const confirmar = useCallback(async (dadosProntos?: DadosCadastro) => {
    const dados: DadosCadastro | null =
      dadosProntos ??
      (numero.trim() ? { tipo, livro, numero: Number(numero) } : null);
    if (!dados) {
      setAviso({ texto: "Informe o número do ponto.", erro: true });
      return;
    }
    setPendente(dados);

    if (!temSuporte()) {
      setPainelNotif("suporte");
      return;
    }
    const permissao = Notification.permission;
    if (permissao === "granted") {
      // Já autorizado: não pede de novo, só confirma a assinatura.
      setOcupado(true);
      try {
        await garantirAssinatura().catch(() => null);
        await enviarCadastro(dados, true);
        setPendente(null);
      } finally {
        setOcupado(false);
      }
    } else if (permissao === "denied") {
      setPainelNotif("negado");
    } else {
      setPainelNotif("pedir");
    }
  }, [numero, tipo, livro, enviarCadastro, garantirAssinatura]);

  /** ATIVAR NOTIFICAÇÕES: pede permissão, cria a subscription e cadastra. */
  const ativarNotificacoes = useCallback(async () => {
    setAtivando(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setPainelNotif("negado");
        return;
      }
      await garantirAssinatura();
      setPainelNotif(null);
      if (pendente) {
        const ok = await enviarCadastro(pendente, false);
        setPendente(null);
        if (ok) {
          setAviso({
            texto: `🟢 Notificações ativadas · ${pendente.livro}${pendente.numero} cadastrado.`,
            erro: false,
          });
        }
      } else {
        setAviso({ texto: "🟢 Notificações ativadas.", erro: false });
      }
    } catch (e) {
      setTeste(
        `⚠️ ${e instanceof Error ? e.message : "Não foi possível ativar."}`,
      );
    } finally {
      setAtivando(false);
    }
  }, [pendente, enviarCadastro, garantirAssinatura]);

  /** Usuário seguiu sem notificações: o cadastro é concluído mesmo assim. */
  const continuarSemNotificacoes = useCallback(async () => {
    if (pendente) {
      setOcupado(true);
      try {
        await enviarCadastro(pendente, false);
        setPendente(null);
      } finally {
        setOcupado(false);
      }
    }
    setPainelNotif(null);
    setAviso({
      texto: "Ponto cadastrado. Notificações não ativadas.",
      erro: true,
    });
  }, [pendente, enviarCadastro]);

  /** Boas-vindas: cria o motorista e, se veio ponto, já manda monitorar. */
  const entrar = useCallback(
    async (d: DadosBoasVindas) => {
      setEntrando(true);
      setErroEntrada("");
      try {
        const r = await fetch("/api/motoristas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nome: d.nome, ponto: d.ponto }),
        });
        const m = await r.json();
        if (!r.ok) {
          setErroEntrada(m.erro ?? "Não foi possível entrar. Tente de novo.");
          return;
        }
        guardarMotorista(m);
        void carregarContagem();
        if (d.ponto) {
          // Mantém os dados no formulário: se algo der errado, não redigita.
          setTipo(d.ponto.tipo);
          setLivro(d.ponto.livro);
          setNumero(String(d.ponto.numero));
          await confirmar(d.ponto);
        } else {
          setAviso({ texto: `Bem-vindo, ${primeiroNome(m.nome)}!`, erro: false });
          // Notificações já liberadas antes: liga este aparelho ao nome.
          if (temSuporte() && Notification.permission === "granted") {
            void garantirAssinatura().catch(() => {});
          }
        }
      } catch {
        setErroEntrada("Sem conexão. Confira a internet e tente de novo.");
      } finally {
        setEntrando(false);
      }
    },
    [confirmar, guardarMotorista, garantirAssinatura, carregarContagem],
  );

  // Aparelho que já tinha notificação liberada: religa ao motorista ao abrir,
  // para os avisos saírem com o nome certo.
  useEffect(() => {
    if (!motorista || !temSuporte() || Notification.permission !== "granted") return;
    void garantirAssinatura().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorista?.id, garantirAssinatura]);

  const renomear = useCallback(
    async (nome: string) => {
      const atual = motoristaRef.current;
      if (!atual) return false;
      try {
        const r = await fetch(`/api/motoristas/${atual.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nome }),
        });
        const m = await r.json();
        if (!r.ok) {
          setAviso({ texto: m.erro ?? "Não foi possível trocar o nome.", erro: true });
          return false;
        }
        guardarMotorista(m);
        setAviso({ texto: "Nome atualizado.", erro: false });
        return true;
      } catch {
        setAviso({ texto: "Sem conexão com o servidor.", erro: true });
        return false;
      }
    },
    [guardarMotorista],
  );

  // ------------------------------------------------ cabeçalho e serviços
  /**
   * Compartilhar: imagem do app + mensagem explicando o que ele faz + link.
   * Celular com suporte a arquivos (Chrome Android, Safari iOS) → manda a
   * imagem junto; senão manda só texto e link; sem nada disso, copia.
   */
  const compartilhar = useCallback(async () => {
    const link = linkDoApp();
    const texto = mensagemCompartilhar(link);
    try {
      if (navigator.share) {
        let arquivo: File | null = null;
        try {
          const r = await fetch(IMAGEM_COMPARTILHAR, { cache: "force-cache" });
          if (r.ok) {
            arquivo = new File([await r.blob()], "copalinks.jpg", { type: "image/jpeg" });
          }
        } catch {
          arquivo = null;
        }
        if (arquivo && navigator.canShare?.({ files: [arquivo] })) {
          // Com arquivo, alguns apps ignoram o campo url: o link já vai no texto.
          await navigator.share({ files: [arquivo], title: NOME_APP, text: texto });
          return;
        }
        await navigator.share({ title: NOME_APP, text: texto, url: link });
        return;
      }
      await navigator.clipboard.writeText(texto);
      setAviso({ texto: "Mensagem e link copiados. É só colar no WhatsApp.", erro: false });
    } catch (e) {
      // Usuário fechou a janela de compartilhar: não é erro.
      if (e instanceof DOMException && e.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(texto);
        setAviso({ texto: "Mensagem e link copiados. É só colar no WhatsApp.", erro: false });
      } catch {
        setAviso({ texto: `Link do aplicativo: ${link}`, erro: false });
      }
    }
  }, []);

  const semLink = useCallback((s: Servico) => {
    setAviso({ texto: `${s.titulo}: link em breve.`, erro: false });
  }, []);

  const abrirCadastro = useCallback(() => {
    if (arrastou.current) return;
    setCadastroAberto(true);
  }, []);

  const alvo = estado.pontos[idx];

  // --------------------------------------- informações do cartão do número
  // "Quadro" = o quadro do livro do ponto mostrado (ex.: pontoa.php p/ Livro A).
  const linhasQuadro = alvo
    ? estado.fila.filter((l) => l.livro === alvo.livro)
    : estado.fila;
  const quadroTruck = linhasQuadro
    .filter((l) => l.tipo === "TRUCK")
    .reduce((s, l) => s + l.naFila, 0);
  const quadroCavalo = linhasQuadro
    .filter((l) => l.tipo === "CAVALO")
    .reduce((s, l) => s + l.naFila, 0);
  const linhaDoAlvo = alvo
    ? estado.fila.find((l) => l.tipo === alvo.tipo && l.livro === alvo.livro)
    : undefined;
  // O quadro oficial escreve A183, B022, M069: conserva os três dígitos no
  // último já chamado, mas não confunde esse número com o 1º da fila atual.
  const ultimoEscalado = linhaDoAlvo?.ultimo
    ? `${linhaDoAlvo.livro}${String(linhaDoAlvo.ultimo).padStart(3, "0")}`
    : "—";
  const ultimoQuando = linhaDoAlvo?.ultimoDesde
    ? haQuanto(linhaDoAlvo.ultimoDesde, agora)
    : linhaDoAlvo
      ? "no quadro"
      : "sem ponto";
  const corStatus =
    alvo?.status === "AGUARDANDO" ? "text-verde" : "text-ambar";

  const selecionarPonto = (i: number) => {
    setIdx(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* --------------------------------------------- blocos reutilizados */
  const blocoSeusPontos = (
    <Painel
      titulo={motorista ? `Seus pontos, ${primeiroNome(motorista.nome)}` : "Seus pontos"}
      corTitulo="text-azulclaro"
      icone={<Crown size={30} className="fill-azulclaro/90 text-azulclaro" strokeWidth={1.8} />}
      acao={
        <BotaoIcone
          rotulo="Editar pontos"
          ativo={editando}
          onClick={() => setEditando((v) => !v)}
        >
          <Pencil size={18} />
        </BotaoIcone>
      }
    >
      {total === 0 ? (
        <p className="py-2 text-[15px] text-aco">Nenhum ponto cadastrado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {estado.pontos.map((p, i) => (
            <LinhaPonto
              key={p.id}
              p={p}
              editando={editando}
              selecionado={i === idx && total > 1}
              onSelecionar={() => selecionarPonto(i)}
              onSalvar={(d) => salvar(p.id, d)}
              onRemover={() => remover(p.id)}
            />
          ))}
        </ul>
      )}
    </Painel>
  );



  return (
    <div className="relative min-h-screen w-full bg-abismo">
      <img
        src={FUNDO.src}
        alt=""
        aria-hidden
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="fixed inset-0 h-full w-full object-cover object-center"
      />
      <div className="fixed inset-0 bg-[linear-gradient(180deg,rgba(4,16,42,0.45)_0%,rgba(3,12,32,0.35)_45%,rgba(2,8,24,0.60)_100%)]" />

      <div className="relative mx-auto w-full max-w-[390px] px-3 pt-3 pb-[118px]">
        {/* =============================================== INÍCIO */}
        {aba === "inicio" && (
          <>
            {/* topo: foto do caminhão (personalizável) atrás do logo e da saudação */}
            <BannerCaminhao motoristaId={motorista?.id ?? null}>
              <Cabecalho
                nome={motorista ? primeiroNome(motorista.nome) : null}
                onCompartilhar={compartilhar}
              />
            </BannerCaminhao>

            {/* ------------------------------------------ cartão do número */}
            <motion.section
              initial={reduzido ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.2, 0.7, 0.3, 1] }}
              className="cartao-monitor relative -mt-14 overflow-hidden rounded-[24px] px-3 pt-3 pb-5"
            >
              <div className="varredura" aria-hidden />

              {/* tipo/livro + seta, no topo à direita: abre/fecha o painel completo */}
              <div className="relative z-10 flex justify-end">
                <button
                  type="button"
                  onClick={() => setExpandido((v) => !v)}
                  aria-expanded={expandido}
                  title={expandido ? "Toque para recolher" : "Toque para abrir o painel"}
                  className="-my-[11px] -mr-1 flex min-h-[44px] max-w-full items-center gap-1 rounded-full pl-3 text-white transition-colors hover:text-ciano"
                >
                  <span className="min-w-0 truncate font-display text-[14.5px] leading-[22px] font-bold">
                    {alvo
                      ? `${ROTULO[alvo.tipo]} - LIVRO ${alvo.livro}`
                      : "Toque para cadastrar um ponto"}
                  </span>
                  {expandido ? (
                    <ChevronUp size={28} className="shrink-0 text-azulclaro" />
                  ) : (
                    <ChevronDown size={28} className="shrink-0 text-azulclaro" />
                  )}
                </button>
              </div>

              {/* número + status (toque = abrir o painel; arrastar = trocar de ponto) */}
              <motion.div
                key={idx}
                initial={reduzido ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35 }}
                drag={total > 1 ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.12}
                onDragStart={() => {
                  arrastou.current = true;
                }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60 && idx < total - 1) setIdx(idx + 1);
                  else if (info.offset.x > 60 && idx > 0) setIdx(idx - 1);
                  setTimeout(() => {
                    arrastou.current = false;
                  }, 60);
                }}
                className="mt-5"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!arrastou.current) setExpandido((v) => !v);
                  }}
                  aria-expanded={expandido}
                  title={expandido ? "Toque para recolher" : "Toque para abrir o painel"}
                  className={`flex w-full flex-wrap items-center gap-y-2 pl-2 text-left ${
                    alvo?.status === "AGUARDANDO" ? "gap-x-3" : "gap-x-4"
                  }`}
                >
                  <span
                    className={`numero-gradiente tabular shrink-0 font-display leading-[0.9] font-black tracking-[-0.04em] drop-shadow-[0_0_26px_rgba(47,155,255,0.45)] ${
                      alvo && alvo.codigo.length > 3
                        ? "text-[clamp(50px,15.5vw,66px)]"
                        : "text-[clamp(64px,21.5vw,92px)]"
                    }`}
                  >
                    {alvo ? alvo.codigo : "—"}
                  </span>
                  {alvo && (
                    <span
                      className={`flex translate-y-[5px] items-center gap-3.5 rounded-full border border-[#1d4690]/80 bg-[#06122b]/90 ${
                        alvo.status === "AGUARDANDO" ? "px-3 py-[7px]" : "px-4 py-3.5"
                      }`}
                    >
                      <Led cor={alvo.status === "AGUARDANDO" ? "verde" : "ambar"} pulsante tamanho={18} />
                      <span className="flex flex-col">
                        <span className={`font-display text-[20.5px] leading-[26px] font-bold ${corStatus}`}>
                          {alvo.status === "AGUARDANDO" ? "ATIVO" : alvo.status}
                        </span>
                        {alvo.status === "AGUARDANDO" && (
                          <span className="tabular whitespace-nowrap text-[12px] leading-[14px] font-semibold text-gelo/75">
                            {alvo.vistoEm ? `${alvo.naFrente} na frente` : "Varrendo…"}
                          </span>
                        )}
                      </span>
                      {/* A posição completa continua acessível sem repetir o contador visível. */}
                      <span className="sr-only">
                        {alvo.status === "SAIU"
                          ? alvo.detalhe
                          : alvo.status === "AGUARDANDO" && alvo.vistoEm
                            ? `fila nº ${alvo.posicao}`
                            : `nº ${alvo.posicao} · ${alvo.detalhe}`}
                      </span>
                    </span>
                  )}
                </button>
              </motion.div>

              {/* informações da fila */}
              <div className="mt-[18px] space-y-3">
                <FaixaInfo
                  icone={<Clock size={24} strokeWidth={2.1} className="text-[#3b82f6]" />}
                  anel="border-[#3b82f6]/70 bg-[#3b82f6]/10 shadow-[0_0_20px_-6px_rgba(59,130,246,0.9)]"
                  rotulo="Último escalado"
                  valor={ultimoEscalado}
                  corValor="text-white"
                  sub={ultimoQuando}
                  divisor
                />
                <FaixaInfo
                  icone={<Truck size={24} strokeWidth={2} className="text-[#f5a524]" />}
                  anel="border-[#f5a524]/70 bg-[#f5a524]/10 shadow-[0_0_20px_-6px_rgba(245,165,36,0.9)]"
                  rotulo="Pontos no quadro"
                  destaque={{ texto: "TRUCK", cor: "text-[#ff9f2e]" }}
                  valor={String(quadroTruck)}
                  corValor="text-[#ff9f2e]"
                  sub="ponto ativo"
                />
                <FaixaInfo
                  icone={<Truck size={24} strokeWidth={2} className="text-[#22c55e]" />}
                  anel="border-[#22c55e]/70 bg-[#22c55e]/10 shadow-[0_0_20px_-6px_rgba(34,197,94,0.9)]"
                  rotulo="Pontos no quadro"
                  destaque={{ texto: "CAVALO/C", cor: "text-[#3ee48a]" }}
                  valor={String(quadroCavalo)}
                  corValor="text-[#3ee48a]"
                  sub="ponto ativo"
                />
              </div>

              {/* rodapé do cartão */}
              <div className="mt-[22px] flex items-center justify-between gap-3 pl-1.5">
                <span className="flex items-center gap-2 text-[15px] leading-6 text-gelo/90">
                  <Clock size={24} strokeWidth={2} className="shrink-0 text-[#3b82f6]" />
                  <span className="tabular" title={estado.temLeitura ? `Última leitura real do quadro: ${hora(estado.atualizadoEm)}` : undefined}>
                    {estado.temLeitura === false
                      ? "Aguardando 1ª leitura"
                      : `Atualizado há ${decorrido(estado.atualizadoEm, agora + desvioRelogio)}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={atualizar}
                  title="Varrer o site agora"
                  className="-my-2.5 flex items-center gap-2 rounded-full px-2 py-2.5 transition-colors hover:bg-white/5"
                >
                  {ocupado ? (
                    <RotateCw size={14} className="animate-spin text-verde" />
                  ) : (
                    <Led cor={estado.online ? "verde" : "ambar"} />
                  )}
                  <span
                    className={`font-display text-[18px] leading-6 font-bold ${
                      estado.online ? "text-verde" : "text-ambar"
                    }`}
                  >
                    {estado.online ? "ONLINE" : "OFFLINE"}
                  </span>
                </button>
              </div>
            </motion.section>

            {/* painel completo: abre ao tocar no número */}
            {expandido && (
              <motion.div
                initial={reduzido ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-2.5 space-y-2.5"
              >
                <CadastroInline
                  tipo={tipo}
                  livro={livro}
                  numero={numero}
                  ocupado={ocupado || ativando}
                  onTipo={setTipo}
                  onLivro={setLivro}
                  onNumero={setNumero}
                  onConfirmar={() => void confirmar()}
                />
                {blocoSeusPontos}
              </motion.div>
            )}

            <motion.div
              initial={reduzido ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
              className="mt-4"
            >
              <Servicos onSemLink={semLink} />
            </motion.div>
          </>
        )}

        {/* =============================================== SOBRE */}
        {aba === "sobre" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center pt-2 text-center">
              <img
                src={LOGO.src}
                alt="CopaLinks"
                width={LOGO.largura}
                height={LOGO.altura}
                className="h-auto w-[min(260px,72vw)]"
              />
              <h1 className="mt-4 font-display text-[24px] font-extrabold text-white">
                Monitor Ponto CopaLinks
              </h1>
              <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-gelo/80">
                Acompanha a fila de ponto do site da Copadubo a cada 5 segundos
                e avisa quando o seu número é chamado.
              </p>
            </div>

            {/* motoristas: contagem + o próprio nome (com troca) */}
            <section className="painel p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_22px_-4px_rgba(47,140,240,0.8)]">
                  <Users size={23} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <div className="tabular font-display text-[30px] leading-none font-extrabold text-white">
                    {totalMotoristas ?? "—"}
                  </div>
                  <div className="mt-1 text-[14px] text-gelo/80">
                    motorista{totalMotoristas === 1 ? "" : "s"} usando o CopaLinks
                  </div>
                </div>
              </div>

              {motorista && (
                <div className="mt-3 flex min-h-[48px] items-center gap-2 rounded-[14px] border border-[#2a5bb0]/55 bg-[#06122b]/70 px-3 py-2">
                  {editandoNome ? (
                    <>
                      <input
                        value={novoNome}
                        onChange={(e) => setNovoNome(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && (await renomear(novoNome))) setEditandoNome(false);
                        }}
                        maxLength={60}
                        autoFocus
                        aria-label="Seu nome"
                        className="min-w-0 flex-1 rounded-full border-[1.5px] border-ouro/60 bg-[#06122b] px-3.5 py-2 font-display text-[15px] font-bold text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (await renomear(novoNome)) setEditandoNome(false);
                        }}
                        aria-label="Salvar nome"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ouro text-[#2a1a00]"
                      >
                        <CheckCircle2 size={19} strokeWidth={2.6} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoNome(false)}
                        aria-label="Cancelar"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-gelo/25 text-gelo"
                      >
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="shrink-0 rounded-full bg-ouro px-2 py-0.5 font-display text-[11px] font-extrabold tracking-[0.06em] text-[#2a1a00] uppercase">
                        Você
                      </span>
                      <span className="min-w-0 flex-1 font-display text-[16px] leading-tight font-bold text-white [overflow-wrap:anywhere]">
                        {motorista.nome}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setNovoNome(motorista.nome);
                          setEditandoNome(true);
                        }}
                        aria-label="Trocar meu nome"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-gelo/20 bg-black/25 text-gelo/80 hover:border-ciano/60 hover:text-ciano"
                      >
                        <Pencil size={16} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>

            <Painel titulo="Notificações" corTitulo="text-white">
              <p className="text-[15px] text-gelo/85">
                {assinada
                  ? "Este aparelho está recebendo os avisos."
                  : "Ative para receber aviso quando o seu número for chamado."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setPainelNotif("geral")}
                  className="ouro flex items-center gap-2 rounded-full px-5 py-3 font-display text-[15px] font-extrabold uppercase"
                >
                  <Bell size={16} /> Ativar notificações
                </button>
              </div>
              {teste && (
                <p className="mt-3 rounded-2xl border border-gelo/12 bg-black/30 px-4 py-3 text-[14px] text-ciano">
                  {teste}
                </p>
              )}
            </Painel>

            {/* Acesso discreto à Área do Administrador */}
            <div className="pt-2 pb-1 text-center">
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gelo/40 transition-colors hover:text-gelo/80"
              >
                <ShieldCheck size={14} className="opacity-60" />
                <span>Painel de administração</span>
              </Link>
            </div>

          </div>
        )}
      </div>

      <NavInferior
        aba={aba}
        onTrocar={setAba}
        totalMotoristas={totalMotoristas}
        onChat={() => setChatAberto(true)}
        naoLidas={naoLidas}
      />

      <ChatMotoristas
        aberto={chatAberto}
        onFechar={() => setChatAberto(false)}
        motorista={motoristaChat}
        onLido={marcarChatLido}
      />

      {cadastroAberto && (
        <FolhaCadastro
          tipo={tipo}
          livro={livro}
          numero={numero}
          ocupado={ocupado || ativando}
          onTipo={setTipo}
          onLivro={setLivro}
          onNumero={setNumero}
          onConfirmar={() => void confirmar()}
          onFechar={() => setCadastroAberto(false)}
        />
      )}

      {perfilPronto && !motorista && (
        <BoasVindas
          enviando={entrando}
          erro={erroEntrada}
          onEntrar={(d) => void entrar(d)}
        />
      )}

      {carregando && <CarregamentoLogo pronto={perfilPronto} onTerminar={terminarCarregamento} />}

      {/* Alerta individual do administrador: só fecha ativando as notificações. */}
      {motorista && <AlertaAdmin motoristaId={motorista.id} onAtivada={() => setAssinada(true)} />}

      {painelNotif && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-abismo/80 p-3 backdrop-blur-md sm:items-center">
          <div className="vidro w-full max-w-[390px] rounded-[30px] p-6">
            <PainelNotificacoes
              modo={painelNotif}
              ativas={ativas}
              assinada={assinada}
              ativando={ativando}
              resultado={teste}
              onAtivar={ativarNotificacoes}
              onAlternarAlertas={() => setAtivas((v) => !v)}
              onContinuar={continuarSemNotificacoes}
              onFechar={() => {
                // Fechou o pedido de notificação com um ponto na mão:
                // o ponto entra no monitoramento mesmo assim.
                if (painelNotif === "pedir" && pendente) void continuarSemNotificacoes();
                else setPainelNotif(null);
              }}
            />
          </div>
        </div>
      )}

      {aviso && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[104px] z-[70] flex justify-center px-4"
        >
          <div
            className={`pill flex items-center gap-2.5 px-4 py-3 text-[14px] font-medium ${
              aviso.erro ? "border-red-400/50 text-red-200" : "text-gelo"
            }`}
          >
            {aviso.erro ? (
              <X size={15} className="text-red-300" />
            ) : (
              <CheckCircle2 size={15} className="text-verde" />
            )}
            {aviso.texto}
          </div>
        </div>
      )}
    </div>
  );
}
