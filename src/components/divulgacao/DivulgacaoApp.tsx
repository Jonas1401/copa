"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Anchor,
  ArrowRight,
  Bell,
  Calculator,
  ChevronLeft,
  CircleCheckBig,
  ClipboardList,
  CloudSun,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Phone,
  QrCode,
  Share2,
  Signal,
  Smartphone,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  BENEFICIOS,
  CABECALHO_PROMO,
  FECHO_PROMO,
  IMAGEM_STATUS,
  NOME_APP,
  PASSOS,
  TITULO_PROMO,
  linhasDaMensagem,
  linkWhatsAppMensagem,
  mensagemCompartilhar,
} from "@/lib/compartilhar";
import { LOGO } from "@/lib/logo";

/* --------------------------------------------------------------- tipos */

/** Evento do Chrome que permite instalar o app (beforeinstallprompt). */
type EventoInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Aparelho = {
  iOS: boolean;
  android: boolean;
  whatsapp: boolean;
  instalado: boolean;
  podeInstalar: boolean;
};

function identificarAparelho(): Aparelho {
  if (typeof window === "undefined") {
    return { iOS: false, android: false, whatsapp: false, instalado: false, podeInstalar: false };
  }
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    iOS,
    android: /Android/i.test(ua),
    whatsapp: /WhatsApp/i.test(ua),
    instalado:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
    podeInstalar: false,
  };
}

/** Como instalar no aparelho que está usando a página agora. */
function instrucoes(app: Aparelho) {
  if (app.instalado) {
    return {
      titulo: "O CopaLinks já está instalado neste aparelho",
      texto: "Abra pelo ícone na tela inicial — ele funciona igual a qualquer outro aplicativo.",
      passos: [] as string[],
    };
  }
  if (app.whatsapp && app.iOS) {
    return {
      titulo: "Saindo do WhatsApp para instalar",
      texto: "O WhatsApp não deixa instalar o app por dentro. Saia dele e volte pelo navegador.",
      passos: [
        "Toque em Compartilhar (quadrado com a seta para cima).",
        "Escolha “Abrir no Safari”.",
        "No Safari, toque em Compartilhar → “Adicionar à Tela de Início”.",
      ],
    };
  }
  if (app.whatsapp) {
    return {
      titulo: "Saindo do WhatsApp para instalar",
      texto: "O WhatsApp não deixa instalar o app por dentro. Saia dele e volte pelo navegador.",
      passos: [
        "Toque nos três pontinhos (⋮) do canto superior.",
        "Escolha “Abrir no Chrome” (ou “Adicionar à tela inicial”).",
        "No Chrome, toque em “Instalar aplicativo”.",
      ],
    };
  }
  if (app.iOS) {
    return {
      titulo: "Instalar no iPhone",
      texto: "No iPhone o app é instalado pela Tela de Início — não existe loja de aplicativos.",
      passos: [
        "Toque no botão Compartilhar (quadrado com a seta para cima) na barra do Safari.",
        "Role e escolha “Adicionar à Tela de Início”.",
        "Toque em “Adicionar” no canto superior direito.",
      ],
    };
  }
  if (app.android) {
    return {
      titulo: "Instalar no Android",
      texto: "O Chrome instala o app em um toque (o mesmo botão das lojas de aplicativos).",
      passos: [
        "Toque nos três pontinhos (⋮) do canto superior direito.",
        "Escolha “Instalar aplicativo” (ou “Adicionar à tela inicial”).",
        "Confirme em “Instalar”.",
      ],
    };
  }
  return {
    titulo: "Instalar no computador",
    texto: "O Chrome e o Edge instalam o app direto da barra de endereço.",
    passos: [
      "Abra o link do CopaLinks no Chrome ou no Edge.",
      "Clique no ícone de instalar (uma tela com uma seta) que aparece na barra de endereço.",
      "Confirme em “Instalar”.",
    ],
  };
}

/* ------------------------------------------------------------- ícones */

/** Um ícone por recurso (mesma ordem da lista BENEFICIOS). */
const ICONES_BENEFICIO = [
  Gauge,
  Bell,
  MapPin,
  CloudSun,
  Calculator,
  Sparkles,
  MessagesSquare,
  Phone,
];

/* ------------------------------------------------------------- página */

export default function DivulgacaoApp({ url }: { url: string }) {
  const [app, setApp] = useState<Aparelho>(() => ({
    iOS: false,
    android: false,
    whatsapp: false,
    instalado: false,
    podeInstalar: false,
  }));
  const [evento, setEvento] = useState<EventoInstalacao | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const mensagem = mensagemCompartilhar(url);
  const linhas = linhasDaMensagem(url);

  /* instalação do app (Chrome/Edge/Android): o navegador avisa que o app
     pode ser instalado e guardamos o evento para disparar o prompt. */
  useEffect(() => {
    const aoPedir = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalacao);
      setApp((a) => ({ ...a, podeInstalar: true }));
    };
    window.addEventListener("beforeinstallprompt", aoPedir);
    // A detecção do aparelho roda depois da hidratação (o servidor não tem
    // window), por isso fica fora do corpo do efeito.
    const t = window.setTimeout(() => {
      setApp((a) => ({ ...identificarAparelho(), podeInstalar: a.podeInstalar }));
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", aoPedir);
    };
  }, []);

  /* QR Code do endereço do app: o motorista aponta a câmera e já abre. */
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#0b1a5e", light: "#ffffff" },
    })
      .then((d) => vivo && setQr(d))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [url]);

  const avisar = useCallback((texto: string) => {
    setRecado(texto);
    window.setTimeout(() => setRecado(null), 3200);
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) {
      avisar("Neste aparelho, instale pelo menu do navegador (veja o passo a passo acima).");
      return;
    }
    try {
      await evento.prompt();
      const escolha = await evento.userChoice;
      if (escolha.outcome === "accepted") {
        setApp((a) => ({ ...a, instalado: true }));
        avisar("CopaLinks instalado. Bom proveito!");
      } else {
        avisar("Instalação cancelada. Você pode instalar depois pelo menu do navegador.");
      }
      setEvento(null);
    } catch {
      avisar("Não deu para instalar agora. Use o passo a passo acima.");
    }
  }, [evento, avisar]);

  const compartilharWhatsApp = useCallback(() => {
    window.open(linkWhatsAppMensagem(mensagem), "_blank", "noopener,noreferrer");
  }, [mensagem]);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mensagem);
      avisar("Mensagem copiada. É só colar no WhatsApp.");
    } catch {
      avisar(mensagem);
    }
  }, [mensagem, avisar]);

  const compartilharNativo = useCallback(async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: NOME_APP, text: mensagem, url });
        return;
      }
      await copiar();
    } catch {
      // usuário fechou a janela de compartilhar: não é erro
    }
  }, [mensagem, url, copiar]);

  const passos = instrucoes(app);

  return (
    <div className="fundo-app relative min-h-screen w-full bg-fundo">
      <main className="largura-aparelho relative px-3 pt-4 pb-12">
        {/* ------------------------------------------------- topo */}
        <header className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Voltar ao app"
            title="Voltar ao app"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#3342d0]/70 bg-[#030856]/80 text-white transition-colors hover:border-ciano/70 hover:text-ciano"
          >
            <ChevronLeft size={26} strokeWidth={2.2} />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(19px,5.6vw,25px)] leading-tight font-extrabold tracking-[0.01em] text-white uppercase">
              {NOME_APP}
            </h1>
            <p className="text-[14px] text-gelo/80">Instale no celular em 1 minuto</p>
          </div>
        </header>

        {/* ------------------------------------------------- chamada */}
        <section className="mt-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO.src}
            alt="CopaLinks"
            width={LOGO.largura}
            height={LOGO.altura}
            className="mx-auto h-auto w-[min(240px,68vw)]"
          />
          <h2 className="mt-4 font-display text-[clamp(21px,6.2vw,28px)] leading-tight font-extrabold text-white">
            {CABECALHO_PROMO}
          </h2>
          <p className="mx-auto mt-2 max-w-[420px] text-[15px] leading-relaxed text-gelo/85">
            {TITULO_PROMO} Acompanhe o seu ponto na fila da Copadubo sem ficar
            atualizando o site.
          </p>

          <div className="mt-5 flex flex-col items-center gap-2.5">
            <Link
              href="/"
              className="ouro flex min-h-[52px] w-full max-w-[420px] items-center justify-center gap-2 rounded-full px-6 font-display text-[16px] font-extrabold uppercase"
            >
              <Truck size={19} strokeWidth={2.4} /> Abrir o app
            </Link>
            <a
              href="#instalar"
              className="flex min-h-[50px] w-full max-w-[420px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ciano/55 bg-[#02042b]/70 px-6 font-display text-[15px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano hover:bg-[#02042b]"
            >
              <Smartphone size={18} strokeWidth={2.2} /> Instalar no celular
            </a>
            <button
              type="button"
              onClick={compartilharWhatsApp}
              className="flex min-h-[50px] w-full max-w-[420px] items-center justify-center gap-2 rounded-full border-[1.5px] border-[#25d366]/55 bg-[#062b14]/60 px-6 font-display text-[15px] font-extrabold text-[#4ce07a] uppercase transition-colors hover:border-[#25d366] hover:bg-[#062b14]"
            >
              <MessageCircle size={18} strokeWidth={2.2} /> Chamar no WhatsApp
            </button>
          </div>
        </section>

        {/* ------------------------------------------------- recursos */}
        <section className="painel mt-6 p-4 sm:p-5">
          <h2 className="flex items-center gap-3 font-display text-[clamp(17px,4.9vw,22px)] leading-[1.05] font-extrabold tracking-[0.01em] text-white uppercase">
            <Signal size={24} strokeWidth={2.2} className="text-verde" /> O que o app faz
          </h2>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {BENEFICIOS.map((b, i) => {
              const Icone = ICONES_BENEFICIO[i] ?? CircleCheckBig;
              return (
                <li
                  key={b.titulo}
                  className="flex items-start gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[#02042b]/60 px-3.5 py-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0b1a5e] text-ciano">
                    <Icone size={19} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <b className="block text-[15px] leading-snug font-extrabold text-white">
                      {b.emoji} {b.titulo}
                    </b>
                    <span className="mt-0.5 block text-[13.5px] leading-snug text-gelo/80">
                      {b.texto}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ------------------------------------------------- instalar */}
        <section id="instalar" className="painel mt-4 p-4 sm:p-5">
          <h2 className="flex items-center gap-3 font-display text-[clamp(17px,4.9vw,22px)] leading-[1.05] font-extrabold tracking-[0.01em] text-white uppercase">
            <Download size={24} strokeWidth={2.2} className="text-ouro" /> Instalar no celular
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-gelo/85">
            O CopaLinks é um app leve: não precisa baixar nada da loja, não pede
            senha e não ocupa espaço. Ele fica na tela inicial do celular,
            igual a qualquer aplicativo.
          </p>

          <div className="mt-4 rounded-[18px] border border-ciano/35 bg-[#02042b]/70 p-3.5">
            <p className="font-display text-[15px] font-extrabold text-ciano">
              {passos.titulo}
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-gelo/85">{passos.texto}</p>
            {passos.passos.length > 0 && (
              <ol className="mt-3 space-y-2">
                {passos.passos.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[14.5px] text-gelo/90">
                    <span className="tabular mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ciano/15 font-display text-[12px] font-extrabold text-ciano">
                      {passos.passos.indexOf(p) + 1}
                    </span>
                    <span className="leading-snug">{p}</span>
                  </li>
                ))}
              </ol>
            )}
            {(app.podeInstalar || app.instalado) && (
              <button
                type="button"
                onClick={instalar}
                disabled={app.instalado}
                className="ouro mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full px-5 font-display text-[15px] font-extrabold uppercase disabled:opacity-70"
              >
                {app.instalado ? (
                  <>
                    <CircleCheckBig size={18} strokeWidth={2.6} /> Já instalado
                  </>
                ) : (
                  <>
                    <Download size={18} strokeWidth={2.4} /> Instalar agora
                  </>
                )}
              </button>
            )}
          </div>

          {/* QR Code: aponta a câmera e abre o app */}
          <div className="mt-4 flex flex-col items-center gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[#02042b]/60 p-4 sm:flex-row sm:items-center sm:gap-5">
            <div className="shrink-0 rounded-[14px] bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt="QR Code do endereço do CopaLinks"
                  width={132}
                  height={132}
                  className="h-[132px] w-[132px]"
                />
              ) : (
                <div className="grid h-[132px] w-[132px] place-items-center text-[#0b1a5e]">
                  <QrCode size={40} />
                </div>
              )}
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <p className="font-display text-[15px] font-extrabold text-white">
                Aponte a câmera do celular
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-gelo/85">
                O QR Code abre o CopaLinks na hora — vale para quem está do lado
                de fora da cabine.
              </p>
              <p className="tabular mt-2 break-all rounded-full border border-ciano/30 bg-[#02042b] px-3 py-1.5 text-[13px] font-semibold text-ciano">
                {url}
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- como funciona */}
        <section className="painel mt-4 p-4 sm:p-5">
          <h2 className="flex items-center gap-3 font-display text-[clamp(17px,4.9vw,22px)] leading-[1.05] font-extrabold tracking-[0.01em] text-white uppercase">
            <ClipboardList size={24} strokeWidth={2.2} className="text-azulclaro" /> Como funciona
          </h2>
          <ol className="mt-4 space-y-3">
            {PASSOS.map((p) => (
              <li key={p.numero} className="flex items-start gap-3">
                <span className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#5376f4,#2c46c8)] font-display text-[15px] font-extrabold text-white shadow-[0_0_18px_-6px_rgba(83,118,244,0.9)]">
                  {p.numero}
                </span>
                <span className="min-w-0">
                  <b className="block font-display text-[15.5px] font-extrabold text-white">
                    {p.titulo}
                  </b>
                  <span className="mt-0.5 block text-[14px] leading-relaxed text-gelo/85">
                    {p.texto}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------- divulgar */}
        <section className="painel mt-4 p-4 sm:p-5">
          <h2 className="flex items-center gap-3 font-display text-[clamp(17px,4.9vw,22px)] leading-[1.05] font-extrabold tracking-[0.01em] text-white uppercase">
            <Share2 size={24} strokeWidth={2.2} className="text-ouro" /> Chame mais motorista
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-gelo/85">
            Mande esta mensagem no grupo do ponto: quem receber já sabe o que o
            app faz e como instalar.
          </p>

          {/* prévia da mensagem (como aparece no WhatsApp) */}
          <div className="mt-4 rounded-[18px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3">
            <div className="max-w-[92%] rounded-[16px] rounded-bl-[6px] bg-[#075E54] px-3.5 py-2.5">
              {linhas.map((linha, i) => (
                <p key={i} className="text-[14px] leading-relaxed text-[#e9edef]">
                  {linha.map((t, j) =>
                    t.negrito ? <b key={j}>{t.texto}</b> : <span key={j}>{t.texto}</span>,
                  )}
                </p>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={compartilharWhatsApp}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border-[1.5px] border-[#25d366]/55 bg-[#062b14]/60 px-4 font-display text-[14px] font-extrabold text-[#4ce07a] uppercase transition-colors hover:border-[#25d366]"
            >
              <MessageCircle size={17} strokeWidth={2.2} /> WhatsApp
            </button>
            <button
              type="button"
              onClick={copiar}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ciano/50 bg-[#02042b]/70 px-4 font-display text-[14px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
            >
              <Copy size={17} strokeWidth={2.2} /> Copiar
            </button>
            <button
              type="button"
              onClick={compartilharNativo}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ciano/50 bg-[#02042b]/70 px-4 font-display text-[14px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
            >
              <Share2 size={17} strokeWidth={2.2} /> Compartilhar
            </button>
          </div>

          {/* imagem de status para o WhatsApp/Instagram */}
          <div className="mt-5 flex flex-col items-center gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[#02042b]/60 p-4 sm:flex-row sm:gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={IMAGEM_STATUS}
              alt="Arte de divulgação do Monitor Ponto CopaLinks"
              width={140}
              height={249}
              className="w-[140px] rounded-[12px] border border-white/10"
            />
            <div className="min-w-0 text-center sm:text-left">
              <p className="font-display text-[15px] font-extrabold text-white">
                Arte para status e grupos
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-gelo/85">
                Baixe a imagem e publique no status do WhatsApp ou no grupo do
                ponto — ela já tem o QR Code do app.
              </p>
              <a
                href={IMAGEM_STATUS}
                download="copalinks-divulgacao.jpg"
                className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ouro/60 bg-[#02042b] px-4 font-display text-[13.5px] font-extrabold text-ouro uppercase transition-colors hover:border-ouro"
              >
                <Download size={16} strokeWidth={2.4} /> Baixar imagem
              </a>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- atalhos */}
        <section className="mt-4 grid gap-2.5 sm:grid-cols-3">
          <Link
            href="/tempo"
            className="flex items-center gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[linear-gradient(180deg,rgba(4,9,84,0.76),rgba(2,6,63,0.82))] px-3.5 py-3 transition-colors hover:border-ciano/60"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0b1a5e] text-ciano">
              <CloudSun size={20} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <b className="block font-display text-[14.5px] font-extrabold text-white">
                Tempo no porto
              </b>
              <span className="text-[12.5px] text-gelo/75">Previsão APPA/SIMPORT</span>
            </span>
            <ArrowRight size={17} className="ml-auto shrink-0 text-gelo/40" />
          </Link>
          <Link
            href="/frete"
            className="flex items-center gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[linear-gradient(180deg,rgba(4,9,84,0.76),rgba(2,6,63,0.82))] px-3.5 py-3 transition-colors hover:border-ciano/60"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0b1a5e] text-ciano">
              <Calculator size={20} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <b className="block font-display text-[14.5px] font-extrabold text-white">
                Cálculo de frete
              </b>
              <span className="text-[12.5px] text-gelo/75">Lê a foto do ticket</span>
            </span>
            <ArrowRight size={17} className="ml-auto shrink-0 text-gelo/40" />
          </Link>
          <Link
            href="/contatos"
            className="flex items-center gap-3 rounded-[18px] border border-[#3342d0]/50 bg-[linear-gradient(180deg,rgba(4,9,84,0.76),rgba(2,6,63,0.82))] px-3.5 py-3 transition-colors hover:border-ciano/60"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0b1a5e] text-ciano">
              <Phone size={20} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <b className="block font-display text-[14.5px] font-extrabold text-white">
                Contatos
              </b>
              <span className="text-[12.5px] text-gelo/75">WhatsApp da equipe</span>
            </span>
            <ArrowRight size={17} className="ml-auto shrink-0 text-gelo/40" />
          </Link>
        </section>

        {/* ------------------------------------------------- rodapé */}
        <footer className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-[13px] text-gelo/60">
            <Anchor size={15} strokeWidth={2.2} /> Porto de Paranaguá · Copadubo
          </p>
          <p className="font-display text-[13.5px] font-extrabold tracking-[0.06em] text-ouro uppercase">
            {FECHO_PROMO}
          </p>
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-[14px] font-bold tracking-[0.06em] text-azulclaro uppercase transition-colors hover:text-ciano"
          >
            <ChevronLeft size={18} strokeWidth={2.6} /> Voltar ao app
          </Link>
          <a
            href={url}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-gelo/45 transition-colors hover:text-gelo/80"
          >
            {url.replace(/^https?:\/\//, "")} <ExternalLink size={13} />
          </a>
        </footer>
      </main>

      {/* recado temporário (copiou, instalou...) */}
      {recado && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <p className="rounded-full border border-ciano/50 bg-[#02042b]/95 px-4 py-3 text-center text-[13.5px] font-semibold text-ciano shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)]">
            {recado}
          </p>
        </div>
      )}
    </div>
  );
}
