"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ImageIcon, Loader2, RotateCcw, Sparkles, X } from "lucide-react";

export const BANNER_PADRAO = "/images/caminhao-padrao.webp";
const LADO_MAX = 1600;

type Estado = "parado" | "processando" | "ok" | "erro";

/** Reduz a foto no próprio celular antes de enviar (mais rápido e dentro do limite). */
async function reduzirFoto(arquivo: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
    if (blob) return blob;
  } catch {
    /* navegador sem suporte: tenta enviar o arquivo como veio */
  }
  return arquivo;
}

/**
 * Topo da tela inicial: foto do caminhão integrada ao fundo, atrás do logo e
 * da saudação. Cada motorista pode trocar pela foto do próprio caminhão; o
 * servidor transforma em imagem profissional e guarda só para ele.
 */
export default function BannerCaminhao({ motoristaId, children }: { motoristaId: number | null; children: ReactNode }) {
  const [versao, setVersao] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [menu, setMenu] = useState(false);
  const [estado, setEstado] = useState<Estado>("parado");
  const [mensagem, setMensagem] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!motoristaId) return;
    let vivo = true;
    fetch("/api/motoristas/banner", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) { setVersao(d?.versao ?? null); setFalhou(false); } })
      .catch(() => {});
    return () => { vivo = false; };
  }, [motoristaId]);

  const aviso = useCallback((e: Estado, texto: string) => {
    setEstado(e);
    setMensagem(texto);
    if (e === "ok" || e === "erro") setTimeout(() => { setEstado("parado"); setMensagem(""); }, 4500);
  }, []);

  async function enviar(arquivo: File | undefined) {
    setMenu(false);
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) { aviso("erro", "Escolha uma foto (JPG, PNG ou WebP)."); return; }
    aviso("processando", "Preparando sua imagem...");
    try {
      const foto = await reduzirFoto(arquivo);
      const form = new FormData();
      form.append("foto", foto, "caminhao.jpg");
      const r = await fetch("/api/motoristas/banner", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.versao) { aviso("erro", d.erro ?? "Não foi possível processar a imagem. Tente novamente."); return; }
      setVersao(d.versao);
      setFalhou(false);
      aviso("ok", "Sua imagem foi atualizada!");
    } catch {
      aviso("erro", "Não foi possível processar a imagem. Tente novamente.");
    }
  }

  async function voltarPadrao() {
    setMenu(false);
    const r = await fetch("/api/motoristas/banner", { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setVersao(null); aviso("ok", "Voltamos para a imagem padrão."); }
    else aviso("erro", "Não consegui voltar para a imagem padrão. Tente de novo.");
  }

  // Sem perfil neste aparelho: sempre a imagem padrão (nada de outro motorista).
  const src = motoristaId && versao && !falhou ? `/api/motoristas/banner/imagem?v=${versao}` : BANNER_PADRAO;

  return (
    <div className="relative -mx-3 -mt-3 overflow-x-clip">
      {/* camada da foto: nítida de cima até a base, só os últimos 5% em degradê */}
      <div aria-hidden className="imagem-nitida pointer-events-none absolute inset-x-0 top-0 -bottom-8 overflow-hidden">
        {/* foto: caminhão à direita, sem deformar (recorte inteligente + object-cover) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden
          fetchPriority="high"
          decoding="async"
          onError={() => setFalhou(true)}
          className="banner-entra absolute inset-0 h-full w-full object-cover object-[68%_46%]"
        />
        {/* integração com o fundo azul: só a base da foto (5%) se dissolve no #002b6b */}
        <div className="absolute inset-x-0 bottom-0 h-[5%] bg-[linear-gradient(180deg,rgba(0,43,107,0)_0%,#002b6b_100%)]" />
      </div>

      <div className="relative px-3 pt-3 pb-[78px]">
        {children}
        <p className="mt-1 max-w-[62%] text-[14px] leading-snug text-gelo/90 drop-shadow-[0_1px_8px_rgba(0,0,0,0.85)]">
          Aqui está o resumo da sua operação de hoje.
        </p>
      </div>

      {motoristaId && (
        <button
          type="button"
          onClick={() => setMenu(true)}
          disabled={estado === "processando"}
          aria-label="Personalizar imagem"
          title="Personalizar imagem"
          className="absolute right-2.5 bottom-[72px] z-10 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/20 text-gelo/55 backdrop-blur-[2px] transition-colors hover:border-white/25 hover:bg-black/40 hover:text-white disabled:opacity-50"
        >
          {estado === "processando" ? <Loader2 size={15} className="animate-spin" /> : <Camera size={16} strokeWidth={1.8} />}
        </button>
      )}

      {estado === "processando" && (
        <div className="absolute inset-0 grid place-items-center bg-[#030c20]/55 backdrop-blur-[2px]" role="status">
          <div className="flex items-center gap-2 rounded-full bg-[#06173a]/90 px-4 py-2.5 text-[14px] font-bold text-white">
            <Sparkles size={17} className="animate-pulse text-ouro" /> {mensagem}
          </div>
        </div>
      )}
      {(estado === "ok" || estado === "erro") && (
        <p
          role="status"
          className={`absolute inset-x-3 top-1/2 z-10 -translate-y-1/2 rounded-2xl px-4 py-2.5 text-center text-[14px] font-bold ${
            estado === "ok" ? "bg-verde/90 text-[#03240f]" : "bg-red-500/90 text-white"
          }`}
        >
          {mensagem}
        </p>
      )}

      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void enviar(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden"
        onChange={(e) => { void enviar(e.target.files?.[0]); e.target.value = ""; }} />

      {menu && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-abismo/75 p-3 backdrop-blur-sm sm:items-center" onClick={() => setMenu(false)}>
          <div role="dialog" aria-modal="true" aria-label="Personalizar imagem"
            className="vidro largura-aparelho rounded-[26px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[19px] font-extrabold text-white">Personalizar imagem</h2>
                <p className="mt-1 text-[13.5px] leading-snug text-gelo/75">
                  Mande a foto do seu caminhão. O CopaLinks deixa ela com cara de foto profissional, mantendo o seu caminhão do jeito que ele é.
                </p>
              </div>
              <button type="button" onClick={() => setMenu(false)} aria-label="Fechar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 grid gap-2.5">
              <button type="button" onClick={() => camera.current?.click()}
                className="ouro flex items-center justify-center gap-2 rounded-full px-5 py-3.5 font-display text-[15px] font-extrabold uppercase">
                <Camera size={18} /> Tirar foto
              </button>
              <button type="button" onClick={() => galeria.current?.click()}
                className="flex items-center justify-center gap-2 rounded-full border border-[#2a5bb0]/80 bg-[#0b2152]/80 px-5 py-3.5 font-display text-[15px] font-bold text-white hover:border-ciano/70">
                <ImageIcon size={18} /> Escolher da galeria
              </button>
              {versao && (
                <button type="button" onClick={() => void voltarPadrao()}
                  className="mt-1 flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] text-gelo/70 hover:text-white">
                  <RotateCcw size={15} /> Voltar para a imagem padrão
                </button>
              )}
            </div>
            <p className="mt-3 text-center text-[11.5px] text-gelo/50">JPG, PNG ou WebP até 8 MB · só você vê a sua imagem</p>
          </div>
        </div>
      )}
    </div>
  );
}
