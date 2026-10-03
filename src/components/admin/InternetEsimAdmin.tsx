"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  CloudDownload,
  Copy,
  ExternalLink,
  History,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  QrCode,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  Wifi,
  X,
} from "lucide-react";

type Api = <T>(url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; dados: T }>;
type Props = { api: Api; onSessaoExpirada: (status: number) => boolean };
type Mode = "TEST" | "PRODUCTION";
type Plan = {
  id: number;
  providerPackageId: string;
  productName: string;
  productCode: string | null;
  name: string;
  code: string | null;
  wholesalePrice: string;
  retailReferencePrice: string | null;
  currency: string;
  dataAmount: string | null;
  dataUnit: string | null;
  durationDays: number | null;
  source: string;
  available: boolean;
  active: boolean;
  syncedAt: string | null;
};
type User = { id: number; motoristaId: number | null; name: string; email: string | null; orders: number; createdAt: string };
type Driver = { id: number; name: string };
type Order = {
  id: number;
  customerName: string;
  customerEmail: string | null;
  planName: string;
  status: string;
  providerOrderCode: string | null;
  providerStatusCode: number | null;
  amount: string;
  costAmount: string;
  currency: string;
  paymentStatus: string;
  paymentMethod: string | null;
  gateway: string;
  createdAt: string;
  updatedAt: string;
};
type EsimRow = {
  id: number;
  customerName: string;
  planName: string;
  orderId: number;
  iccid: string | null;
  status: string;
  providerStatus: string | null;
  source: string;
  totalDataAmount: string | null;
  totalDataUnit: string | null;
  usedAmount: string | null;
  remainingAmount: string | null;
  usageUnit: string | null;
  usageStatus: string | null;
  usageNote: string | null;
  usageCheckedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  hasInstallationData: boolean;
};
type Webhook = { id: number; provider: string; eventType: string | null; providerOrderCode: string | null; status: string; result: string; receivedAt: string; processedAt: string | null };
type ApiError = { id: number; requestId: string; operation: string; httpStatus: number | null; providerErrorCode: string | null; message: string; createdAt: string };
type Dashboard = {
  provider: {
    mode: Mode;
    apiKeyConfigured: boolean;
    apiUrlConfigured: boolean;
    webhookSecretConfigured: boolean;
    providerReady: boolean;
    sandboxDocumented: false;
    docsUrl: string;
  };
  paymentGatewayConfigured: boolean;
  marginPercent: number;
  totals: { plans: number; orders: number; payments: number; esims: number; webhooks: number };
  plans: Plan[];
  customers: User[];
  eligibleCustomers: Driver[];
  orders: Order[];
  esims: EsimRow[];
  webhookEvents: Webhook[];
  apiErrors: ApiError[];
};
type EsimDetails = {
  id: number;
  iccid: string | null;
  status: string;
  providerStatus: string | null;
  qrCode: string | null;
  qrUrl: string | null;
  activationCode: string | null;
  installationUrl: string | null;
  smDp: string | null;
  expiresAt: string | null;
  source: string;
  createdAt: string;
};

type Aba = "resumo" | "planos" | "pedidos" | "esims" | "clientes" | "webhooks" | "config";
const ABAS: { id: Aba; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "planos", label: "Planos" },
  { id: "pedidos", label: "Pedidos" },
  { id: "esims", label: "Meus eSIMs" },
  { id: "clientes", label: "Clientes" },
  { id: "webhooks", label: "Webhooks / erros" },
  { id: "config", label: "Configurações" },
];
const CARD = "rounded-[20px] border border-[#2a5bb0]/55 bg-[#061735]/80 p-3.5 sm:p-4";
const MUTED = "text-[12px] leading-relaxed text-gelo/60";
const BUTTON = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#3768b8]/70 bg-[#0b2655] px-3.5 py-2 text-[12px] font-bold text-white transition hover:border-ciano/70 hover:text-ciano disabled:cursor-not-allowed disabled:opacity-45";
const INPUT = "w-full rounded-[12px] border border-[#2a5bb0]/70 bg-[#06122b] px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-gelo/40 focus:border-ciano/70";

function moeda(value: string | number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${value} ${currency}`; }
}
function dataHora(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}
function precoCliente(plan: Plan, margin: number) {
  const cost = Number(plan.wholesalePrice);
  if (!Number.isFinite(cost)) return "—";
  return moeda((Math.round(cost * (1 + margin / 100) * 100) / 100).toFixed(2), plan.currency);
}
function labelStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
function Tag({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "red" }) {
  const palette = {
    blue: "border-ciano/25 bg-ciano/10 text-ciano",
    green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    amber: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    red: "border-red-400/25 bg-red-400/10 text-red-200",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-extrabold tracking-wide ${palette}`}>{children}</span>;
}
function QRPreview({ value }: { value: string }) {
  const [resultado, setResultado] = useState<{ value: string; src?: string; error?: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    // QR is generated locally in this admin browser; no payload is sent to an outside service.
    void QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 2, width: 240 })
      .then((src) => { if (active) setResultado({ value, src }); })
      .catch(() => { if (active) setResultado({ value, error: true }); });
    return () => { active = false; };
  }, [value]);
  const resultadoAtual = resultado?.value === value ? resultado : null;
  return (
    <div className="grid min-h-56 place-items-center rounded-2xl border border-white/10 bg-white p-3">
      {resultadoAtual?.src ? <Image src={resultadoAtual.src} alt="QR Code do eSIM" width={208} height={208} unoptimized className="h-52 w-52" /> : resultadoAtual?.error ? <span className="text-xs text-red-700">Não foi possível montar o QR. Use o código manual.</span> : <span className="text-xs text-slate-600">Gerando QR localmente…</span>}
    </div>
  );
}

export default function InternetEsimAdmin({ api, onSessaoExpirada }: Props) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>("resumo");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [margem, setMargem] = useState("0");
  const [planoSelecionado, setPlanoSelecionado] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState("");
  const [chavesTentativa, setChavesTentativa] = useState<Record<string, string>>({});
  const [detalhe, setDetalhe] = useState<EsimDetails | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const response = await api<Dashboard>("/api/admin/esim");
      if (onSessaoExpirada(response.status)) return;
      if (!response.ok) {
        setErro((response.dados as unknown as { erro?: string })?.erro ?? "Não foi possível carregar o painel Internet/eSIM.");
        return;
      }
      setDashboard(response.dados);
      setMargem(String(response.dados.marginPercent));
      setErro("");
    } catch {
      setErro("Falha de conexão ao carregar Internet/eSIM.");
    } finally {
      setCarregando(false);
    }
  }, [api, onSessaoExpirada]);

  useEffect(() => { if (aberto && !dashboard) void carregar(); }, [aberto, dashboard, carregar]);

  const planosAtivos = useMemo(() => dashboard?.plans.filter((plan) => plan.active && plan.available) ?? [], [dashboard]);
  const planosDemo = useMemo(() => planosAtivos.filter((plan) => plan.source === "test-fixture"), [planosAtivos]);

  async function acao<T>(key: string, url: string, init: RequestInit, sucesso: (dados: T) => string) {
    setOcupado(key);
    setErro("");
    setAviso("");
    try {
      const response = await api<T & { erro?: string }>(url, init);
      if (onSessaoExpirada(response.status)) return;
      if (!response.ok) {
        setErro(response.dados.erro ?? "A operação não foi concluída.");
        return;
      }
      setAviso(sucesso(response.dados));
      await carregar();
    } catch {
      setErro("Falha de conexão ao concluir a operação. Atualize o painel antes de repetir.");
    } finally {
      setOcupado(null);
    }
  }

  async function sincronizarCatalogo() {
    await acao<{ count: number; source: string; mode: Mode }>(
      "catalog",
      "/api/admin/esim/catalog",
      { method: "POST" },
      (result) => result.source === "test-fixture"
        ? `${result.count} planos de demonstração carregados; não são dados da NexaEsim.`
        : `${result.count} planos atualizados do catálogo NexaEsim.`,
    );
  }

  async function salvarMargem() {
    const value = Number(margem.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 500) {
      setErro("Informe uma margem entre 0% e 500%.");
      return;
    }
    await acao<{ marginPercent: number }>(
      "margin",
      "/api/admin/esim/settings",
      { method: "PATCH", body: JSON.stringify({ marginPercent: value }) },
      (result) => `Margem salva em ${result.marginPercent.toFixed(2)}%.`,
    );
  }

  async function alternarPlano(plan: Plan) {
    await acao<{ active: boolean }>(
      `plan:${plan.id}`,
      `/api/admin/esim/plans/${plan.id}`,
      { method: "PATCH", body: JSON.stringify({ active: !plan.active }) },
      (result) => result.active ? "Plano ativado." : "Plano desativado.",
    );
  }

  async function criarPedido() {
    if (!planoSelecionado || !clienteSelecionado) {
      setErro("Selecione um plano e um cliente.");
      return;
    }
    const context = `${planoSelecionado}:${clienteSelecionado}`;
    const storageKey = `copalinks:esim:test-order:${context}`;
    let storedKey: string | null = chavesTentativa[context] ?? null;
    if (!storedKey) {
      try { storedKey = sessionStorage.getItem(storageKey); } catch { /* storage pode estar bloqueado no navegador */ }
    }
    const key = storedKey || `admin-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    setChavesTentativa((current) => ({ ...current, [context]: key }));
    try { sessionStorage.setItem(storageKey, key); } catch { /* a chave ainda permanece no estado da tela */ }
    setOcupado("order-create");
    setErro("");
    try {
      const result = await api<{ orderId: number; status: string; aviso: string } & { erro?: string }>("/api/admin/esim/orders", {
        method: "POST",
        body: JSON.stringify({ planId: Number(planoSelecionado), motoristaId: Number(clienteSelecionado), idempotencyKey: key }),
      });
      if (onSessaoExpirada(result.status)) return;
      if (!result.ok) {
        setErro(result.dados.erro ?? "Não foi possível criar o pedido de teste.");
        return;
      }
      setAviso(`Pedido de demonstração #${result.dados.orderId} criado. Nenhuma cobrança foi feita.`);
      setErro("");
      setChavesTentativa((current) => {
        const next = { ...current };
        delete next[context];
        return next;
      });
      try { sessionStorage.removeItem(storageKey); } catch { /* não afeta o pedido confirmado */ }
      await carregar();
    } catch {
      // Keep the same attempt key so a manual retry cannot create another order.
      setErro("Falha de conexão. Tente novamente: a mesma chave idempotente será reutilizada.");
    } finally {
      setOcupado(null);
    }
  }

  async function carregarDetalhe(id: number) {
    setOcupado(`details:${id}`);
    setErro("");
    try {
      const result = await api<EsimDetails & { erro?: string }>(`/api/admin/esim/esims/${id}`);
      if (onSessaoExpirada(result.status)) return;
      if (!result.ok) { setErro(result.dados.erro ?? "Não foi possível abrir os dados de instalação."); return; }
      setDetalhe(result.dados);
    } catch { setErro("Não foi possível abrir os dados de instalação."); }
    finally { setOcupado(null); }
  }

  async function copiarCodigo(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { setErro("Não foi possível copiar neste navegador."); }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border-[1.5px] border-ciano/35 bg-[linear-gradient(180deg,rgba(9,30,68,0.97),rgba(4,16,39,0.98))] shadow-[0_16px_50px_rgba(0,12,40,0.22)]">
      <button type="button" onClick={() => setAberto((value) => !value)} aria-expanded={aberto} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-blue-500 text-[#04142f] shadow-lg shadow-cyan-950/40"><Wifi size={25} strokeWidth={2.4} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[18px] font-extrabold text-white sm:text-[20px]">📶 Internet / eSIM</span>
            {dashboard ? (dashboard.provider.mode === "PRODUCTION" ? <Tag tone="red">PRODUÇÃO</Tag> : <Tag tone="amber">TESTE · PRIVADO</Tag>) : <Tag tone="blue">PRIVADO</Tag>}
          </span>
          <span className="mt-0.5 block text-[12px] text-gelo/60">Gestão restrita ao administrador · não aparece no menu público</span>
        </span>
        {aberto ? <ChevronUp className="shrink-0 text-gelo/70" size={20} /> : <ChevronDown className="shrink-0 text-gelo/70" size={20} />}
      </button>

      {aberto && (
        <div className="border-t border-[#2a5bb0]/40 p-3 sm:p-5">
          {(erro || aviso) && <div role="status" className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${erro ? "border-red-400/30 bg-red-500/10 text-red-100" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"}`}>
            {erro ? <AlertTriangle size={17} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0" />}{erro || aviso}
          </div>}
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className={MUTED}>Área de ensaio isolada. As rotas de dados e as credenciais ficam no backend e exigem sessão de administrador.</p>
            <button type="button" className={`${BUTTON} shrink-0`} onClick={() => void carregar()} disabled={carregando || Boolean(ocupado)} aria-label="Atualizar painel">
              {carregando ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}<span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>
          <nav aria-label="Seções Internet/eSIM" className="barra-rolagem mb-4 flex gap-2 overflow-x-auto pb-2">
            {ABAS.map((item) => <button key={item.id} type="button" onClick={() => setAba(item.id)} className={`shrink-0 rounded-full border px-3.5 py-2 text-[11px] font-extrabold transition ${aba === item.id ? "border-ciano/65 bg-ciano/15 text-ciano" : "border-[#2a5bb0]/45 bg-[#081b3d] text-gelo/65 hover:text-white"}`}>{item.label}</button>)}
          </nav>
          {!dashboard && carregando && <div className="grid min-h-48 place-items-center text-gelo/65"><span className="flex items-center gap-2"><LoaderCircle size={18} className="animate-spin" /> Carregando Internet/eSIM…</span></div>}
          {dashboard && <>
            {aba === "resumo" && <Resumo data={dashboard} />}
            {aba === "planos" && <Planos
              data={dashboard}
              ocupado={ocupado}
              onSincronizar={() => void sincronizarCatalogo()}
              onAlternar={(plan) => void alternarPlano(plan)}
            />}
            {aba === "pedidos" && <Pedidos
              data={dashboard}
              ocupado={ocupado}
              plano={planoSelecionado}
              cliente={clienteSelecionado}
              onPlano={setPlanoSelecionado}
              onCliente={setClienteSelecionado}
              onCriar={() => void criarPedido()}
              onAprovar={(id) => void acao<{ status: string }>(`pay:${id}`, `/api/admin/esim/orders/${id}/approve-test`, { method: "POST" }, () => `Pagamento simulado para o pedido #${id}. Perfil real não foi emitido.`)}
              onConsultar={(id) => void acao<{ status: string }>(`query:${id}`, `/api/admin/esim/orders/${id}/query`, { method: "POST" }, (result) => `Consulta NexaEsim: ${labelStatus(result.status)}.`)}
              onRetentar={(id) => void acao<{ status: string }>(`retry:${id}`, `/api/admin/esim/orders/${id}/retry`, { method: "POST" }, (result) => `Provisionamento: ${labelStatus(result.status)}.`)}
            />}
            {aba === "esims" && <Esims
              data={dashboard}
              ocupado={ocupado}
              onUsage={(id) => void acao<{ status: string; note?: string }>(`usage:${id}`, `/api/admin/esim/esims/${id}/usage`, { method: "POST" }, (result) => result.note ?? `Consulta: ${labelStatus(result.status)}.`)}
              onInstall={(id) => void carregarDetalhe(id)}
              onTopup={(id) => void acao<{ erro?: string }>(`topup:${id}`, `/api/admin/esim/esims/${id}/topup`, { method: "POST" }, () => "")}
            />}
            {aba === "clientes" && <Clientes customers={dashboard.customers} drivers={dashboard.eligibleCustomers} />}
            {aba === "webhooks" && <Webhooks events={dashboard.webhookEvents} errors={dashboard.apiErrors} />}
            {aba === "config" && <Configuracoes
              data={dashboard}
              margin={margem}
              onMargin={setMargem}
              onSaveMargin={() => void salvarMargem()}
              busy={ocupado === "margin"}
            />}
          </>}
        </div>
      )}

      {detalhe && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#020817]/85 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="esim-install-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetalhe(null); }}>
        <div className="barra-rolagem max-h-[94dvh] w-full max-w-[560px] overflow-y-auto rounded-[22px] border border-ciano/30 bg-[#071831] p-4 shadow-2xl sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ciano/15 text-ciano"><QrCode size={21} /></span>
            <div className="min-w-0 flex-1"><h3 id="esim-install-title" className="font-display text-lg font-extrabold text-white">Instalar eSIM</h3><p className={MUTED}>Dados de instalação protegidos · administrador</p></div>
            <button type="button" onClick={() => setDetalhe(null)} className="grid h-9 w-9 place-items-center rounded-full text-gelo/65 hover:bg-white/10 hover:text-white" aria-label="Fechar"><X size={19} /></button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[240px_1fr]">
            {detalhe.qrCode ? <QRPreview value={detalhe.qrCode} /> : <div className="grid min-h-44 place-items-center rounded-2xl border border-white/10 bg-[#0b2249] p-4 text-center text-xs text-gelo/60">A NexaEsim não enviou o conteúdo do QR neste evento.</div>}
            <div className="space-y-3">
              {detalhe.iccid && <CampoInstalacao label="ICCID" value={detalhe.iccid} />}
              {detalhe.smDp && <CampoInstalacao label="SM-DP+" value={detalhe.smDp} />}
              {detalhe.activationCode && <CampoInstalacao label="Código de ativação (se fornecido)" value={detalhe.activationCode} />}
              {!detalhe.activationCode && <p className={MUTED}>A documentação pública atual não apresenta campo de código de ativação separado. Se a resposta não trouxer esse dado, use o QR recebido; não extraímos nem inventamos códigos.</p>}
              {detalhe.installationUrl && <a href={detalhe.installationUrl} target="_blank" rel="noreferrer" className={`${BUTTON} w-full`}><ExternalLink size={15} /> Abrir URL oficial de instalação</a>}
              {detalhe.qrUrl && <a href={detalhe.qrUrl} target="_blank" rel="noreferrer" className={`${BUTTON} w-full`}><ExternalLink size={15} /> Abrir QR hospedado pela NexaEsim</a>}
            </div>
          </div>
          {detalhe.qrCode && <div className="mt-4"><p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-gelo/55">Conteúdo para instalação manual</p><div className="flex gap-2 rounded-xl border border-[#2a5bb0]/40 bg-[#041026] p-2.5"><code className="barra-rolagem min-w-0 flex-1 overflow-x-auto break-all text-[11px] leading-relaxed text-gelo/80">{detalhe.qrCode}</code><button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ciano hover:bg-white/10" type="button" onClick={() => void copiarCodigo(detalhe.qrCode!)} aria-label="Copiar conteúdo do QR">{copiado ? <CheckCircle2 size={16} /> : <Copy size={16} />}</button></div></div>}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-3.5">
            <h4 className="flex items-center gap-2 text-[13px] font-extrabold text-white"><BookOpen size={16} className="text-ciano" /> Instalação manual</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-gelo/70">
              <li>Conecte o celular ao Wi-Fi e confirme que ele aceita eSIM e está desbloqueado.</li>
              <li><b>iPhone/iPad:</b> Ajustes → Celular/Dados móveis → Adicionar eSIM → Usar QR Code.</li>
              <li><b>Android:</b> Configurações → Conexões/Gerenciador de SIM (ou Rede e Internet → SIMs) → Adicionar eSIM → Ler QR Code.</li>
              <li>Escaneie o QR em outra tela. Guarde o perfil e não apague o eSIM instalado.</li>
            </ol>
            <a className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-ciano hover:underline" href="https://nexaesim.com/installation-guide" target="_blank" rel="noreferrer">Abrir guia oficial NexaEsim <ExternalLink size={13} /></a>
          </div>
          <p className="mt-3 text-[11px] text-amber-100/75">A instalação automática do sistema depende do dispositivo e de uma URL/deep link oficial compatível. O endpoint de callback documenta QR e URL, mas não documenta um comando universal de instalação no app; por isso não iniciamos instalação silenciosamente.</p>
        </div>
      </div>}
    </section>
  );
}

function CampoInstalacao({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#2a5bb0]/35 bg-[#041026] p-2.5"><span className="block text-[10px] font-extrabold uppercase tracking-wide text-gelo/45">{label}</span><span className="mt-1 block break-all font-mono text-[11px] text-white">{value}</span></div>;
}

function Resumo({ data }: { data: Dashboard }) {
  const cards = [
    { label: "Planos", value: data.totals.plans, icon: PackageCheck },
    { label: "Pedidos", value: data.totals.orders, icon: History },
    { label: "Pagamentos aprovados", value: data.totals.payments, icon: CircleDollarSign },
    { label: "eSIMs", value: data.totals.esims, icon: Smartphone },
  ];
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{cards.map((card) => <div key={card.label} className={CARD}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-gelo/55">{card.label}</span><card.icon size={16} className="text-ciano" /></div><p className="mt-2 font-display text-2xl font-extrabold text-white">{card.value}</p></div>)}</div>
    <div className={CARD}>
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-200"><AlertTriangle size={19} /></span><div><h3 className="text-sm font-extrabold text-white">Sandbox da NexaEsim não documentado publicamente</h3><p className="mt-1 text-[12px] leading-relaxed text-gelo/70">A documentação oficial v1 consultada publica apenas a base de PRODUÇÃO. Por segurança, TESTE usa catálogo e fluxo locais fictícios e não envia chamadas nem pedidos à NexaEsim. Não use credenciais de produção durante o piloto.</p></div></div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><ShieldCheck size={17} className="text-ciano" /> Acesso e credenciais</h3><div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <LinhaConfig label="NEXAESIM_API_KEY" value={data.provider.apiKeyConfigured} /><LinhaConfig label="NEXAESIM_API_URL" value={data.provider.apiUrlConfigured} /><LinhaConfig label="NEXAESIM_WEBHOOK_SECRET" value={data.provider.webhookSecretConfigured} /><LinhaConfig label="Gateway / webhook de pagamento" value={data.paymentGatewayConfigured} />
      </div><p className="mt-3 text-[11px] text-gelo/50">A tela mostra apenas se as variáveis estão presentes. Valores, finais, URL e cabeçalhos secretos não são devolvidos pela API nem exibidos no app.</p></div>
      <div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><Activity size={17} className="text-ciano" /> Bloqueios antes de produção</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-gelo/70"><li>Não há gateway de pagamento configurado no código atual do CopaLinks.</li><li>A NexaEsim informa os preços da API em USD; conversão/tarifa para BRL não foi inventada.</li><li>Os schemas públicos de uso, saldo e recarga não têm campos completos para mapeamento.</li><li>Checkout de cliente e link no aplicativo público permanecem desativados.</li></ul></div>
    </div>
    <div className="flex flex-wrap items-center gap-2"><Tag tone={data.provider.mode === "TEST" ? "amber" : data.provider.providerReady ? "green" : "red"}>{data.provider.mode === "TEST" ? "MODO TESTE" : data.provider.providerReady ? "PRODUÇÃO CONFIGURADA" : "PRODUÇÃO INCOMPLETA"}</Tag><Tag tone={data.provider.providerReady ? "green" : "amber"}>{data.provider.providerReady ? "Integração configurada" : "Provedor não habilitado para venda"}</Tag><span className={MUTED}>Webhook NexaEsim recebidos: {data.totals.webhooks}</span></div>
  </div>;
}

function LinhaConfig({ label, value }: { label: string; value: boolean }) {
  return <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/10 px-2.5 py-2"><span className="truncate font-mono text-[10px] text-gelo/65">{label}</span><Tag tone={value ? "green" : "amber"}>{value ? "CONFIGURADA" : "AUSENTE"}</Tag></div>;
}

function Planos({ data, ocupado, onSincronizar, onAlternar }: { data: Dashboard; ocupado: string | null; onSincronizar: () => void; onAlternar: (plan: Plan) => void }) {
  return <div className="space-y-3">
    <div className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}><div><h3 className="text-sm font-extrabold text-white">Catálogo e preços</h3><p className={MUTED}>Custo / referência conforme catálogo. Preço CopaLinks = custo NexaEsim + margem configurada. Moeda do catálogo: USD.</p></div><button type="button" className={BUTTON} onClick={onSincronizar} disabled={Boolean(ocupado)}>{ocupado === "catalog" ? <LoaderCircle size={16} className="animate-spin" /> : <CloudDownload size={16} />}{data.provider.mode === "TEST" ? "Carregar planos de demonstração" : "Sincronizar catálogo NexaEsim"}</button></div>
    {data.provider.mode === "TEST" && <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-[11px] text-amber-100/80">Os planos abaixo são valores fictícios locais para testar interface e margem. Não representam preço, cobertura ou disponibilidade NexaEsim.</p>}
    {data.plans.length === 0 && <div className={`${CARD} py-8 text-center text-sm text-gelo/55`}>Nenhum plano carregado. Em TESTE, carregue os exemplos locais. Em PRODUÇÃO, somente uma sincronização autenticada usa a API oficial.</div>}
    <div className="grid gap-2.5 md:grid-cols-2">{data.plans.map((plan) => <article key={plan.id} className={CARD}>
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><Tag tone={plan.source === "test-fixture" ? "amber" : "blue"}>{plan.source === "test-fixture" ? "DEMO" : "NEXAESIM"}</Tag><Tag tone={plan.available ? "green" : "red"}>{plan.available ? "NO CATÁLOGO" : "INDISPONÍVEL"}</Tag><Tag tone={plan.active ? "green" : "amber"}>{plan.active ? "ATIVO" : "DESATIVADO"}</Tag></div><h4 className="mt-2 font-display text-[15px] font-extrabold text-white">{plan.name}</h4><p className="text-[11px] text-gelo/55">{plan.productName}{plan.code ? ` · ${plan.code}` : ""}</p></div><button type="button" className={`${BUTTON} min-h-9 px-3`} onClick={() => onAlternar(plan)} disabled={Boolean(ocupado)}>{ocupado === `plan:${plan.id}` ? <LoaderCircle size={14} className="animate-spin" /> : null}{plan.active ? "Desativar" : "Ativar"}</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-lg bg-white/[0.035] p-2"><span className="text-gelo/50">Custo Nexa</span><b className="mt-0.5 block text-white">{moeda(plan.wholesalePrice, plan.currency)}</b></div><div className="rounded-lg bg-ciano/[0.06] p-2"><span className="text-gelo/50">Preço com margem</span><b className="mt-0.5 block text-ciano">{precoCliente(plan, data.marginPercent)}</b></div><div className="rounded-lg bg-white/[0.035] p-2"><span className="text-gelo/50">Dados</span><b className="mt-0.5 block text-white">{plan.dataAmount ? `${plan.dataAmount} ${plan.dataUnit ?? ""}` : "não informado"}</b></div><div className="rounded-lg bg-white/[0.035] p-2"><span className="text-gelo/50">Validade</span><b className="mt-0.5 block text-white">{plan.durationDays ? `${plan.durationDays} dias` : "não informada"}</b></div></div>
      <p className="mt-2 break-all font-mono text-[10px] text-gelo/35">ID de pacote: {plan.providerPackageId}</p>
    </article>)}</div>
  </div>;
}

function Pedidos({ data, ocupado, plano, cliente, onPlano, onCliente, onCriar, onAprovar, onConsultar, onRetentar }: {
  data: Dashboard; ocupado: string | null; plano: string; cliente: string;
  onPlano: (value: string) => void; onCliente: (value: string) => void; onCriar: () => void;
  onAprovar: (id: number) => void; onConsultar: (id: number) => void; onRetentar: (id: number) => void;
}) {
  const canCreateTest = data.provider.mode === "TEST";
  const demoPlans = data.plans.filter((item) => item.source === "test-fixture" && item.active && item.available);
  return <div className="space-y-3">
    {canCreateTest ? <div className={CARD}><div className="flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-200" /><div><h3 className="text-sm font-extrabold text-white">Simular compra (sem cobrança)</h3><p className={MUTED}>Cria um pedido e pagamento pendente local. A aprovação de teste não chama gateway ou NexaEsim e não gera um perfil instalável.</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <select value={plano} onChange={(event) => onPlano(event.target.value)} className={INPUT} aria-label="Plano de demonstração"><option value="">Escolha um plano demo</option>{demoPlans.map((item) => <option key={item.id} value={item.id}>{item.name} · {precoCliente(item, data.marginPercent)}</option>)}</select>
      <select value={cliente} onChange={(event) => onCliente(event.target.value)} className={INPUT} aria-label="Cliente CopaLinks"><option value="">Escolha um cliente CopaLinks</option>{data.eligibleCustomers.map((item) => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}</select>
      <button type="button" className={BUTTON} onClick={onCriar} disabled={!plano || !cliente || Boolean(ocupado)}>{ocupado === "order-create" ? <LoaderCircle size={15} className="animate-spin" /> : <CircleDollarSign size={15} />}Criar pedido</button>
    </div><p className="mt-2 text-[10px] text-gelo/45">Clientes da lista são perfis Motoristas existentes; o eSIM é associado ao perfil selecionado. Não há checkout público.</p></div> : <div className="rounded-xl border border-red-300/25 bg-red-300/[0.06] p-3 text-[12px] text-red-100">Checkout de produção desativado. Nenhum gateway está integrado e nenhum pedido real será criado neste painel.</div>}
    {data.orders.length === 0 && <div className={`${CARD} py-8 text-center text-sm text-gelo/55`}>Ainda não há pedidos.</div>}
    <div className="space-y-2">{data.orders.map((order) => <article key={order.id} className={CARD}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="font-display text-[14px] font-extrabold text-white">Pedido #{order.id} · {order.customerName}</h4><p className="mt-0.5 text-[11px] text-gelo/55">{order.planName} · {dataHora(order.createdAt)}</p></div><div className="flex flex-wrap gap-1.5"><Tag tone={order.paymentStatus === "PAID" ? "green" : order.paymentStatus === "PENDING" ? "amber" : "red"}>Pagamento: {labelStatus(order.paymentStatus)}</Tag><Tag tone={order.status.includes("FAILED") ? "red" : order.status.includes("TEST") ? "amber" : "blue"}>{labelStatus(order.status)}</Tag></div></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[12px] font-bold text-ciano">{moeda(order.amount, order.currency)} <span className="font-normal text-gelo/40">· custo {moeda(order.costAmount, order.currency)}</span></span><div className="flex flex-wrap gap-2">{canCreateTest && order.paymentStatus === "PENDING" && <button type="button" className={BUTTON} onClick={() => onAprovar(order.id)} disabled={Boolean(ocupado)}>{ocupado === `pay:${order.id}` ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Aprovar teste</button>}{data.provider.mode === "PRODUCTION" && order.providerOrderCode && <button type="button" className={BUTTON} onClick={() => onConsultar(order.id)} disabled={Boolean(ocupado)}><RefreshCw size={14} />Consultar Nexa</button>}{data.provider.mode === "PRODUCTION" && order.paymentStatus === "PAID" && ["PROVISIONING_FAILED", "PROVISIONING_UNCERTAIN", "PAID"].includes(order.status) && <button type="button" className={BUTTON} onClick={() => onRetentar(order.id)} disabled={Boolean(ocupado)}><RefreshCw size={14} />Tentar novamente</button>}</div></div>{order.providerOrderCode && <p className="mt-2 break-all font-mono text-[10px] text-gelo/40">Pedido NexaEsim: {order.providerOrderCode}</p>}</article>)}</div>
  </div>;
}

function Esims({ data, ocupado, onUsage, onInstall, onTopup }: { data: Dashboard; ocupado: string | null; onUsage: (id: number) => void; onInstall: (id: number) => void; onTopup: (id: number) => void }) {
  return <div className="space-y-3">
    <div className="rounded-xl border border-amber-200/20 bg-amber-100/[0.05] p-3 text-[11px] leading-relaxed text-amber-100/80">GB utilizados/disponíveis só serão exibidos quando o schema oficial de resposta de consumo da NexaEsim estiver documentado. O painel não inventa nomes de campos. Nenhum QR de teste é instalável.</div>
    {data.esims.length === 0 && <div className={`${CARD} py-8 text-center text-sm text-gelo/55`}>Nenhum eSIM entregue. Em TESTE, a aprovação é apenas simulada e não emite perfil de operadora.</div>}
    <div className="grid gap-2.5 md:grid-cols-2">{data.esims.map((sim) => <article key={sim.id} className={CARD}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-wider text-ciano">{sim.customerName}</p><h4 className="mt-1 font-display text-[14px] font-extrabold text-white">{sim.planName}</h4></div><Tag tone={sim.status === "DISPONIVEL" ? "green" : sim.source === "test-fixture" ? "amber" : "blue"}>{labelStatus(sim.status)}</Tag></div><div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><CampoSim label="ICCID" value={sim.iccid ?? "Ainda não recebido"} /><CampoSim label="GB incluídos" value={sim.totalDataAmount ? `${sim.totalDataAmount} ${sim.totalDataUnit ?? ""}` : "não informado"} /><CampoSim label="GB usados" value={sim.usedAmount ? `${sim.usedAmount} ${sim.usageUnit ?? ""}` : "Aguardando schema oficial"} /><CampoSim label="Validade" value={sim.expiresAt ? dataHora(sim.expiresAt) : "não recebida"} /></div>{sim.providerStatus && <p className="mt-2 text-[10px] text-gelo/45">Status Nexa informado: <span className="font-mono">{sim.providerStatus}</span> (valor original, não interpretado)</p>}{sim.usageNote && <p className="mt-2 text-[10px] text-amber-100/65">{sim.usageNote}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} onClick={() => onUsage(sim.id)} disabled={Boolean(ocupado)}>{ocupado === `usage:${sim.id}` ? <LoaderCircle size={14} className="animate-spin" /> : <Activity size={14} />}Atualizar consumo</button><button type="button" className={BUTTON} onClick={() => onTopup(sim.id)} disabled title="Endpoint de recarga não publicado nas docs atuais"><RefreshCw size={14} />Recarregar · indisponível</button>{sim.hasInstallationData && sim.status === "DISPONIVEL" && sim.source === "nexa" && <button type="button" className={BUTTON} onClick={() => onInstall(sim.id)} disabled={Boolean(ocupado)}><QrCode size={14} />Instalar eSIM</button>}</div></article>)}</div>
  </div>;
}
function CampoSim({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/[0.035] p-2"><span className="block text-[10px] text-gelo/45">{label}</span><b className="mt-1 block break-all text-[11px] text-white">{value}</b></div>; }

function Clientes({ customers, drivers }: { customers: User[]; drivers: Driver[] }) {
  return <div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><Users size={17} className="text-ciano" /> Clientes com atividade eSIM</h3>{customers.length ? <ul className="mt-3 divide-y divide-white/5">{customers.map((user) => <li key={user.id} className="flex items-center justify-between gap-2 py-2.5"><span className="min-w-0"><b className="block truncate text-[13px] text-white">{user.name}</b><span className="text-[10px] text-gelo/45">{user.email || "e-mail não informado"} · perfil motorista #{user.motoristaId ?? "—"}</span></span><Tag>{user.orders} pedido(s)</Tag></li>)}</ul> : <p className={`${MUTED} mt-3`}>Ainda não há compras eSIM associadas a clientes.</p>}</div><div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><Smartphone size={17} className="text-ciano" /> Perfis CopaLinks selecionáveis no piloto</h3><p className="mt-1 text-[11px] text-gelo/50">A seleção associa o pedido ao ID autenticado do perfil Motoristas; não é uma lista pública.</p><div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">{drivers.map((driver) => <div key={driver.id} className="flex justify-between gap-2 rounded-lg bg-white/[0.035] px-2.5 py-2 text-[12px] text-white"><span>{driver.name}</span><span className="font-mono text-gelo/45">#{driver.id}</span></div>)}{!drivers.length && <p className={MUTED}>Nenhum perfil disponível.</p>}</div></div></div></div>;
}

function Webhooks({ events, errors }: { events: Webhook[]; errors: ApiError[] }) {
  return <div className="grid gap-3 lg:grid-cols-2"><div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><RadioTower size={17} className="text-ciano" /> Últimos callbacks</h3><p className={`${MUTED} mt-1`}>Hashes e metadados apenas. Corpos, códigos QR, URLs e segredos não são mostrados.</p>{events.length ? <ul className="mt-3 max-h-[480px] divide-y divide-white/5 overflow-y-auto">{events.map((event) => <li key={event.id} className="py-2.5"><div className="flex flex-wrap items-center justify-between gap-1"><b className="text-[12px] text-white">{event.provider} · {event.eventType ?? "evento"}</b><Tag tone={event.status.includes("ERRO") ? "red" : event.status.includes("PENDENTE") ? "amber" : "green"}>{labelStatus(event.status)}</Tag></div><p className="mt-1 break-all font-mono text-[10px] text-gelo/45">{event.providerOrderCode || "sem código de pedido"} · {dataHora(event.receivedAt)}</p><p className="mt-1 text-[10px] text-gelo/55">{event.result || "—"}</p></li>)}</ul> : <p className={`${MUTED} mt-3`}>Nenhum webhook recebido.</p>}</div><div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><AlertTriangle size={17} className="text-amber-200" /> Erros de integração</h3><p className={`${MUTED} mt-1`}>Sem headers ou corpos da NexaEsim. Use a referência para correlação segura.</p>{errors.length ? <ul className="mt-3 max-h-[480px] divide-y divide-white/5 overflow-y-auto">{errors.map((error) => <li key={error.id} className="py-2.5"><div className="flex flex-wrap items-center justify-between gap-1"><b className="text-[12px] text-white">{error.operation}</b><span className="text-[10px] text-gelo/45">HTTP {error.httpStatus ?? "—"} · {dataHora(error.createdAt)}</span></div><p className="mt-1 text-[11px] text-red-100/80">{error.message}</p><p className="mt-1 font-mono text-[9px] text-gelo/40">{error.requestId}{error.providerErrorCode ? ` · código ${error.providerErrorCode}` : ""}</p></li>)}</ul> : <p className={`${MUTED} mt-3`}>Nenhum erro registrado.</p>}</div></div>;
}

function Configuracoes({ data, margin, onMargin, onSaveMargin, busy }: { data: Dashboard; margin: string; onMargin: (value: string) => void; onSaveMargin: () => void; busy: boolean }) {
  return <div className="space-y-3"><div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><CircleDollarSign size={17} className="text-ciano" /> Margem CopaLinks</h3><p className={`${MUTED} mt-1`}>A margem percentual é calculada sobre o custo wholesale do catálogo. O preço final é arredondado em centavos. Os valores de referência da NexaEsim são USD.</p><div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row"><label className="relative flex-1"><input className={`${INPUT} pr-9`} type="number" min="0" max="500" step="0.01" value={margin} onChange={(event) => onMargin(event.target.value)} aria-label="Margem em percentual" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gelo/45">%</span></label><button type="button" className={BUTTON} onClick={onSaveMargin} disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Salvar margem</button></div><p className="mt-2 text-[10px] text-gelo/45">A margem fica no banco; modo TESTE/PRODUÇÃO depende exclusivamente da variável NEXAESIM_MODE no backend.</p></div>
    <div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><KeyRound size={17} className="text-ciano" /> Ambiente e conexão NexaEsim</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><LinhaConfig label="Modo de teste ativo" value={data.provider.mode === "TEST"} /><LinhaConfig label="API Key presente no servidor" value={data.provider.apiKeyConfigured} /><LinhaConfig label="API URL oficial presente" value={data.provider.apiUrlConfigured} /><LinhaConfig label="Webhook secret presente no servidor" value={data.provider.webhookSecretConfigured} /></div><p className="mt-3 text-[11px] leading-relaxed text-gelo/60">A troca de ambiente é feita apenas com <code>NEXAESIM_MODE</code>. Não existe botão para enviar a integração a produção. Mantenha as três variáveis NexaEsim exclusivamente nos Secrets/Environment Variables do backend.</p><a href={data.provider.docsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-ciano hover:underline">Documentação oficial NexaEsim Partner API <ExternalLink size={14} /></a></div>
    <div className={CARD}><h3 className="flex items-center gap-2 text-sm font-extrabold text-white"><CircleDollarSign size={17} className="text-amber-200" /> Pagamento, saldo e recarga</h3><ul className="mt-2 list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-gelo/70"><li>O repositório não tinha gateway Pix/cartão configurado. A confirmação recebe um contrato backend assinado; um adaptador específico do provedor de pagamento precisa ser configurado antes de cobrar clientes.</li><li>A API NexaEsim documenta o saldo pelo Account API (Bearer token do portal), separado da API Key de comércio; sem token e schema público completo, o saldo não é consultado/exibido.</li><li>A documentação atual não publica endpoint de recarga de eSIM. A tabela está preparada, mas o botão não envia pedido nem cobrança.</li><li>Cancelamento/reembolso depende do gateway configurado. A integração não solicita cancelamento de perfil Nexa sem endpoint oficial documentado.</li></ul></div>
    <div className="flex items-start gap-2 rounded-xl border border-[#2a5bb0]/30 bg-[#07162e] p-3 text-[11px] text-gelo/55"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ciano" /><span>Sem acesso público ao painel: nenhum link Internet/eSIM foi adicionado à página inicial ou à navegação dos motoristas. Rotas internas exigem autenticação de administrador; callbacks são protegidos por HMAC e idempotência.</span></div>
  </div>;
}
