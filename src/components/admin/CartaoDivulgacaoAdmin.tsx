"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  QrCode,
  Share2,
  Smartphone,
} from "lucide-react";
import {
  IMAGEM_COMPARTILHAR,
  IMAGEM_DIVULGACAO,
  IMAGEM_STATUS,
  NOME_APP,
  linhasDaMensagem,
  linkWhatsAppMensagem,
  mensagemCompartilhar,
} from "@/lib/compartilhar";

/**
 * CARTÃO DE DIVULGAÇÃO DO APP — exclusivo da ÁREA DO ADMINISTRADOR (`/admin`).
 *
 * Concentra todo o material da campanha num lugar só: o endereço público do
 * app, o QR Code (a câmera aponta e abre), a mensagem pronta (a mesma do
 * WhatsApp e da página /divulgacao, montada em `src/lib/compartilhar.ts`) e as
 * artes para o status e para a prévia do link.
 *
 * O texto e a arte vêm sempre da fonte única do lib, então o que o
 * administrador manda no grupo é exatamente o que o app promete.
 */
export default function CartaoDivulgacaoAdmin({ url }: { url: string }) {
  const [aberto, setAberto] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const mensagem = mensagemCompartilhar(url);
  const linhas = linhasDaMensagem(url);

  /* QR Code do endereço do app: só vale a pena gerar quando o cartão abre. */
  useEffect(() => {
    if (!aberto) return;
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
  }, [aberto, url]);

  const avisar = useCallback((texto: string) => {
    setRecado(texto);
    window.setTimeout(() => setRecado(null), 3200);
  }, []);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mensagem);
      avisar("Mensagem copiada. É só colar no WhatsApp.");
    } catch {
      avisar(mensagem);
    }
  }, [mensagem, avisar]);

  const compartilharWhatsApp = useCallback(() => {
    window.open(linkWhatsAppMensagem(mensagem), "_blank", "noopener,noreferrer");
  }, [mensagem]);

  /**
   * Compartilhamento nativo: manda a arte do app junto com a mensagem
   * (celular com suporte a arquivo). Sem esse recurso, copia o texto.
   */
  const compartilhar = useCallback(async () => {
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
          await navigator.share({ files: [arquivo], title: NOME_APP, text: mensagem });
          return;
        }
        await navigator.share({ title: NOME_APP, text: mensagem, url });
        return;
      }
      await copiar();
    } catch {
      // usuário fechou a janela de compartilhar: não é erro
    }
  }, [mensagem, url, copiar]);

  return (
    <section className="mt-4 rounded-[22px] border border-[#3342d0]/60 bg-[#02063d]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#619bff] uppercase">
            <Share2 size={22} strokeWidth={2.2} /> Divulgação do app
          </h2>
          <p className="mt-0.5 text-[12.5px] text-gelo/60">
            QR Code, mensagem pronta e artes para divulgar o {NOME_APP}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gelo/70">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-[#3342d0]/35 pt-3">
          <p className="text-[13.5px] leading-snug text-gelo/80">
            Material pronto da campanha: o endereço do app, o QR Code para
            apontar a câmera, a mensagem com o texto oficial e as artes para o
            status do WhatsApp. Tudo sai daqui — a página pública de divulgação
            fica com o passo a passo de instalação.
          </p>

          {/* ------------------------------------- endereço + QR Code */}
          <div className="mt-3 flex flex-col items-center gap-3 rounded-[16px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3.5 sm:flex-row sm:items-center sm:gap-4">
            <div className="shrink-0 rounded-[12px] bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt="QR Code do endereço do app"
                  width={124}
                  height={124}
                  className="h-[124px] w-[124px]"
                />
              ) : (
                <div className="grid h-[124px] w-[124px] place-items-center text-[#0b1a5e]">
                  <QrCode size={36} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="font-display text-[15px] font-extrabold text-white">
                Endereço do app
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-gelo/80">
                Aponte a câmera e o app abre na hora — vale para quem está do
                lado de fora da cabine.
              </p>
              <p className="tabular mt-2 break-all rounded-full border border-ciano/30 bg-[#02042b] px-3 py-1.5 text-[12.5px] font-semibold text-ciano">
                {url}
              </p>
              <div className="mt-2.5 flex flex-wrap justify-center gap-2 sm:justify-start">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full border border-ciano/55 bg-[#02042b]/70 px-3.5 py-2 font-display text-[13px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
                >
                  <Smartphone size={15} strokeWidth={2.2} /> Abrir o app
                </a>
                <Link
                  href="/divulgacao"
                  target="_blank"
                  className="flex items-center gap-1.5 rounded-full border border-ciano/55 bg-[#02042b]/70 px-3.5 py-2 font-display text-[13px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
                >
                  Página de divulgação <ExternalLink size={14} />
                </Link>
              </div>
            </div>
          </div>

          {/* --------------------------------------------- a mensagem */}
          <div className="mt-3 rounded-[16px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3.5">
            <p className="font-display text-[15px] font-extrabold text-white">
              Mensagem para o grupo
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-gelo/80">
              Mande esta mensagem no grupo do ponto: quem receber já sabe o que
              o app faz e como instalar.
            </p>

            {/* prévia da mensagem (como aparece no WhatsApp) */}
            <div className="mt-3 rounded-[14px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3">
              <div className="max-w-[92%] rounded-[16px] rounded-bl-[6px] bg-[#075E54] px-3.5 py-2.5">
                {linhas.map((linha, i) => (
                  <p key={i} className="text-[13.5px] leading-relaxed text-[#e9edef]">
                    {linha.map((t, j) =>
                      t.negrito ? <b key={j}>{t.texto}</b> : <span key={j}>{t.texto}</span>,
                    )}
                  </p>
                ))}
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={compartilharWhatsApp}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-full border-[1.5px] border-[#25d366]/55 bg-[#062b14]/60 px-3 font-display text-[13.5px] font-extrabold text-[#4ce07a] uppercase transition-colors hover:border-[#25d366]"
              >
                <MessageCircle size={16} strokeWidth={2.2} /> WhatsApp
              </button>
              <button
                type="button"
                onClick={() => void copiar()}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ciano/50 bg-[#02042b]/70 px-3 font-display text-[13.5px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
              >
                <Copy size={16} strokeWidth={2.2} /> Copiar
              </button>
              <button
                type="button"
                onClick={() => void compartilhar()}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-full border-[1.5px] border-ciano/50 bg-[#02042b]/70 px-3 font-display text-[13.5px] font-extrabold text-ciano uppercase transition-colors hover:border-ciano"
              >
                <Share2 size={16} strokeWidth={2.2} /> Compartilhar
              </button>
            </div>
          </div>

          {/* ------------------------------------------------- artes */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-2.5 rounded-[16px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3.5 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMAGEM_STATUS}
                alt="Arte de divulgação do app para status"
                width={120}
                height={213}
                className="w-[120px] rounded-[12px] border border-white/10"
              />
              <p className="font-display text-[14px] font-extrabold text-white">
                Arte para status
              </p>
              <p className="text-[12.5px] leading-snug text-gelo/75">
                Já vem com o QR Code do app: é só publicar no status ou no grupo
                do ponto.
              </p>
              <a
                href={IMAGEM_STATUS}
                download="copalinks-divulgacao.jpg"
                className="flex min-h-[42px] items-center justify-center gap-2 rounded-full border border-ouro/60 bg-[#02042b] px-4 font-display text-[13px] font-extrabold text-ouro uppercase transition-colors hover:border-ouro"
              >
                <Download size={15} strokeWidth={2.4} /> Baixar arte
              </a>
            </div>

            <div className="flex flex-col items-center gap-2.5 rounded-[16px] border border-[#3342d0]/50 bg-[#02042b]/60 p-3.5 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMAGEM_DIVULGACAO}
                alt="Cartão de divulgação do app (prévia do link)"
                width={240}
                height={126}
                className="w-full max-w-[240px] rounded-[12px] border border-white/10"
              />
              <p className="font-display text-[14px] font-extrabold text-white">
                Cartão do link
              </p>
              <p className="text-[12.5px] leading-snug text-gelo/75">
                A arte que aparece na prévia do link no WhatsApp, Instagram e
                qualquer rede social.
              </p>
              <a
                href={IMAGEM_DIVULGACAO}
                download="copalinks-card.jpg"
                className="flex min-h-[42px] items-center justify-center gap-2 rounded-full border border-ouro/60 bg-[#02042b] px-4 font-display text-[13px] font-extrabold text-ouro uppercase transition-colors hover:border-ouro"
              >
                <Download size={15} strokeWidth={2.4} /> Baixar cartão
              </a>
            </div>
          </div>

          {/* recado temporário (copiou, instalou...) */}
          {recado && (
            <p className="mt-3 rounded-[12px] border border-ciano/50 bg-[#02042b]/95 px-3 py-2 text-center text-[13px] font-semibold text-ciano">
              {recado}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
