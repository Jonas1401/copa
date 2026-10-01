"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Calculator,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  ImageIcon,
  Percent,
  Share2,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  PORCENTAGENS,
  brl,
  calcular,
  escolherLeitura,
  lerPorCoordenadas,
  lerPorTexto,
  lerPorcentagem,
  lerTotalDoTicket,
  num,
  textoWhatsApp,
  toneladas,
  type Calculo,
  type Palavra,
} from "@/lib/frete";

const CHAVE_HISTORICO = "copalinks-frete-historico-v1";
const CHAVE_PORCENTAGEM = "copalinks-frete-porcentagem-v1";

const STATUS_OCR: Record<string, string> = {
  "loading tesseract core": "Carregando o leitor de imagem",
  "initializing tesseract": "Iniciando a leitura",
  "loading language traineddata": "Carregando o reconhecimento de números",
  "initializing api": "Preparando a imagem",
  "recognizing text": "Lendo os números do ticket",
};

/** Deixa a foto em tons de cinza e com mais contraste para o OCR. */
async function prepararImagem(arquivo: File) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const maior = Math.max(img.naturalWidth, img.naturalHeight);
    const escala = Math.min(2.5, Math.max(1, 2200 / Math.max(maior, 1)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Não foi possível preparar a imagem.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = dados.data;
    for (let i = 0; i < px.length; i += 4) {
      const cinza = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      const c = Math.max(0, Math.min(255, (cinza - 128) * 1.35 + 128));
      const v = c > 245 ? 255 : c < 35 ? 0 : c;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(dados, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function lerHistorico(): Calculo[] {
  try {
    const bruto = localStorage.getItem(CHAVE_HISTORICO);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function dataHora(ms: number) {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* --------------------------------------------------------------- blocos */

function Bloco({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`painel p-4 ${className}`}>{children}</section>;
}

function Numero({
  rotulo,
  valor,
  cor,
  sub,
}: {
  rotulo: string;
  valor: string;
  cor: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-[16px] border border-[#1d4690]/70 bg-[#06122b]/70 px-2.5 py-2.5 text-center">
      <div className="text-[12px] font-medium text-gelo/80">{rotulo}</div>
      <div
        className={`tabular mt-1 truncate font-display text-[clamp(16px,4.8vw,21px)] leading-tight font-extrabold ${cor}`}
      >
        {valor}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-gelo/70">{sub}</div>}
    </div>
  );
}

function Resumo({ c }: { c: Calculo }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Numero rotulo="Bruto" valor={brl(c.bruto)} cor="text-white" />
        <Numero
          rotulo="Cargas"
          valor={String(c.cargas.length)}
          cor="text-azulclaro"
          sub={`${toneladas(c.toneladas)} t`}
        />
        <Numero
          rotulo="Seu ganho"
          valor={brl(c.ganho)}
          cor="text-ouro"
          sub={`${num(c.porcentagem)}%`}
        />
      </div>

      <h3 className="mt-4 mb-2 font-display text-[15px] font-extrabold tracking-[0.04em] text-white uppercase">
        Detalhamento por carga ({c.cargas.length})
      </h3>
      <div className="overflow-hidden rounded-[16px] border border-[#1d4690]/70">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-[#0b2152] text-left text-[11px] tracking-[0.08em] text-gelo/75 uppercase">
              <th className="py-2 pl-3 font-semibold">Carga</th>
              <th className="py-2 font-semibold">Ponto</th>
              <th className="py-2 text-right font-semibold">Quant</th>
              <th className="py-2 text-right font-semibold">Valor</th>
              <th className="py-2 pr-3 text-right font-semibold">Frete</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {c.cargas.map((k, i) => (
              <tr key={k.id} className={i % 2 ? "bg-white/[0.03]" : ""}>
                <td className="py-2 pl-3 text-gelo/70">{i + 1}</td>
                <td className="py-2 font-semibold text-ciano">{k.ponto ?? c.ponto ?? "—"}</td>
                <td className="py-2 text-right text-white">{toneladas(k.quant)}</td>
                <td className="py-2 text-right text-white">{num(k.valor)}</td>
                <td className="py-2 pr-3 text-right font-bold text-white">
                  {brl(k.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular">
            <tr className="border-t border-[#1d4690]/70 bg-[#0b2152] font-bold">
              <td className="py-2.5 pl-3 text-gelo/80" colSpan={2}>
                Total
              </td>
              <td className="py-2.5 text-right text-white">{toneladas(c.toneladas)}</td>
              <td />
              <td className="py-2.5 pr-3 text-right text-white">{brl(c.bruto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ app */

export default function FreteApp() {
  const [aba, setAba] = useState<"calcular" | "historico">("calcular");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [porcentagem, setPorcentagem] = useState("18");
  const [calculando, setCalculando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<Calculo | null>(null);
  const [totalTicket, setTotalTicket] = useState<{ viagens: number; tons: number } | null>(
    null,
  );
  const [problemas, setProblemas] = useState<string[]>([]);
  const [historico, setHistorico] = useState<Calculo[]>([]);
  const [aberto, setAberto] = useState<Calculo | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const resultadoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistorico(lerHistorico());
    const p = localStorage.getItem(CHAVE_PORCENTAGEM);
    if (p && lerPorcentagem(p)) setPorcentagem(p);
  }, []);

  useEffect(() => {
    if (!arquivo) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const salvarHistorico = useCallback((lista: Calculo[]) => {
    setHistorico(lista);
    try {
      localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(lista));
    } catch {
      /* armazenamento cheio/indisponível: o cálculo continua valendo */
    }
  }, []);

  const pct = lerPorcentagem(porcentagem);
  const podeCalcular = Boolean((arquivo || texto.trim()) && pct && !calculando);

  function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArquivo(f);
    setErro("");
    setStatus("Foto pronta. Toque em Calcular — o app acha Quant e Valor sozinho.");
  }

  function limparFoto() {
    setArquivo(null);
    if (entrada.current) entrada.current.value = "";
  }

  async function executar() {
    const p = lerPorcentagem(porcentagem);
    if (!p) {
      setErro("Informe uma porcentagem válida entre 0 e 100.");
      return;
    }
    localStorage.setItem(CHAVE_PORCENTAGEM, String(p));
    setErro("");
    setCalculando(true);
    setProgresso(0);
    let textoLido = texto;

    try {
      if (arquivo) {
        setStatus("Melhorando a imagem para ler melhor…");
        const imagem = await prepararImagem(arquivo);
        const Tesseract = await import("tesseract.js");
        const worker = await Tesseract.createWorker(
          "eng",
          1,
          {
            logger: (m: { status: string; progress?: number }) => {
              setProgresso(Math.round((m.progress ?? 0) * 100));
              setStatus(STATUS_OCR[m.status] ?? "Lendo o ticket no aparelho");
            },
          },
          { load_system_dawg: "0", load_freq_dawg: "0", load_punc_dawg: "0" },
        );
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            preserve_interword_spaces: "1",
          });
          setStatus("Lendo o ticket inteiro com as posições das colunas…");
          const r = await worker.recognize(
            imagem,
            { rotateAuto: true },
            { blocks: true, text: true },
          );
          textoLido = r.data.text ?? "";
          setTexto(textoLido);

          const palavras: Palavra[] = [];
          for (const b of r.data.blocks ?? [])
            for (const par of b.paragraphs ?? [])
              for (const linha of par.lines ?? [])
                for (const w of linha.words ?? []) {
                  if (w.confidence < 25 || !w.text.trim()) continue;
                  palavras.push({
                    texto: w.text.trim(),
                    x0: w.bbox.x0,
                    y0: w.bbox.y0,
                    x1: w.bbox.x1,
                    y1: w.bbox.y1,
                    xc: Math.round((w.bbox.x0 + w.bbox.x1) / 2),
                    yc: Math.round((w.bbox.y0 + w.bbox.y1) / 2),
                  });
                }

          // Duas leituras (posição na foto e texto linha a linha): fica a que
          // bate com o TOTAL GERAL do ticket, ou a mais completa.
          const porTexto = lerPorTexto(textoLido);
          const escolhida = escolherLeitura(
            [lerPorCoordenadas(palavras), porTexto],
            lerTotalDoTicket(textoLido),
          );
          if (escolhida.cargas.length) {
            concluir(
              calcular(escolhida, p),
              textoLido,
              "Foto lida.",
              porTexto.problemas ?? [],
            );
            return;
          }
        } finally {
          await worker.terminate();
        }
      }

      const porTexto = lerPorTexto(textoLido);
      if (!porTexto.cargas.length) {
        throw new Error(
          porTexto.problemas?.length
            ? "Achei as cargas, mas os valores saíram ilegíveis. Corrija o texto abaixo e calcule de novo."
            : "Não encontrei as colunas Quant e Valor. Envie a foto do ticket inteiro ou cole o texto abaixo.",
        );
      }
      concluir(calcular(porTexto, p), textoLido, "Cálculo feito pelo texto.", porTexto.problemas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível calcular.");
      setStatus("");
    } finally {
      setCalculando(false);
    }
  }

  function concluir(
    c: Calculo,
    textoLido: string,
    origem: string,
    ilegiveis: string[],
  ) {
    setResultado(c);
    setProblemas(ilegiveis);
    setTotalTicket(lerTotalDoTicket(textoLido));
    salvarHistorico([c, ...lerHistorico()].slice(0, 80));
    limparFoto();
    setStatus(
      `${origem} ${c.cargas.length} carga${c.cargas.length === 1 ? "" : "s"}${
        c.ponto ? ` · Ponto ${c.ponto}` : ""
      }. Salvo no histórico.`,
    );
    setTimeout(
      () => resultadoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      120,
    );
  }

  function compartilhar(c: Calculo) {
    const msg = textoWhatsApp(c);
    if (navigator.share) {
      navigator.share({ text: msg }).catch(() => {});
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }

  const acumulado = useMemo(
    () => historico.reduce((s, c) => s + c.ganho, 0),
    [historico],
  );

  // Soma confere com o "TOTAL GERAL" impresso no ticket?
  const conferencia =
    resultado && totalTicket
      ? {
          ok:
            totalTicket.viagens === resultado.cargas.length &&
            Math.abs(totalTicket.tons - resultado.toneladas) < 0.01,
          ...totalTicket,
        }
      : null;

  return (
    <div className="relative min-h-screen w-full bg-[#063a78]">

      <main className="relative mx-auto w-full max-w-[360px] px-3 pt-4 pb-12">
        {/* cabeçalho */}
        <header className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Voltar ao início"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 text-white transition-colors hover:border-ciano/70 hover:text-ciano"
          >
            <ChevronLeft size={26} strokeWidth={2.2} />
          </Link>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_22px_-4px_rgba(47,140,240,0.8)]">
            <Calculator size={22} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(20px,6vw,26px)] leading-tight font-extrabold text-white">
              Frete Fácil
            </h1>
            <p className="text-[13.5px] text-gelo/80">Calculadora do Motorista</p>
          </div>
        </header>

        {/* abas */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-full border border-[#1d4690]/70 bg-[#06122b]/80 p-1.5">
          {(
            [
              ["calcular", "Calcular", Calculator],
              ["historico", "Histórico", History],
            ] as const
          ).map(([id, rotulo, Icone]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setAba(id);
                setAberto(null);
              }}
              aria-pressed={aba === id}
              className={`flex items-center justify-center gap-2 rounded-full py-2.5 font-display text-[15px] font-bold transition-colors ${
                aba === id ? "bg-[#2f8cf0] text-white" : "text-gelo/75 hover:text-white"
              }`}
            >
              <Icone size={17} /> {rotulo}
              {id === "historico" && historico.length > 0 && (
                <span className="tabular rounded-full bg-black/25 px-1.5 text-[12px]">
                  {historico.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ================================================= CALCULAR */}
        {aba === "calcular" && (
          <div className="mt-3 space-y-3">
            {/* destaque */}
            <section className="cartao-monitor relative overflow-hidden rounded-[24px] px-4 py-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-gelo/85">
                <Wallet size={18} className="text-ouro" /> Você vai receber
              </div>
              <div className="tabular mt-1 font-display text-[clamp(38px,12vw,54px)] leading-none font-black text-ouro drop-shadow-[0_0_24px_rgba(245,197,24,0.3)]">
                {brl(resultado?.ganho ?? 0)}
              </div>
              <p className="mt-2 text-[13.5px] leading-snug text-gelo/80">
                {resultado
                  ? `${num(resultado.porcentagem)}% de ${brl(resultado.bruto)} · ${resultado.cargas.length} cargas`
                  : "Envie a foto do ticket inteiro — o app acha Quant e Valor sozinho."}
              </p>
            </section>

            {/* como funciona */}
            <Bloco>
              <h2 className="font-display text-[16px] font-extrabold tracking-[0.04em] text-white uppercase">
                Como funciona
              </h2>
              <ol className="mt-3 grid grid-cols-3 gap-2">
                {[
                  [Camera, "Foto do ticket inteiro"],
                  [Percent, "Escolha sua porcentagem"],
                  [Wallet, "Veja quanto vai receber"],
                ].map(([Icone, t], i) => {
                  const I = Icone as typeof Camera;
                  return (
                    <li
                      key={i}
                      className="flex flex-col items-center gap-1.5 rounded-[14px] border border-[#1d4690]/60 bg-[#06122b]/60 px-1.5 py-2.5 text-center"
                    >
                      <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[#2f8cf0]/20 text-azulclaro">
                        <I size={18} />
                        <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-ouro text-[10px] font-black text-[#2a1a00]">
                          {i + 1}
                        </span>
                      </span>
                      <span className="text-[12px] leading-tight text-gelo/85">{t as string}</span>
                    </li>
                  );
                })}
              </ol>
            </Bloco>

            {/* foto */}
            <Bloco>
              <input
                ref={entrada}
                type="file"
                accept="image/*"
                onChange={escolherFoto}
                className="hidden"
                id="foto-ticket"
              />
              {previa ? (
                <div className="relative overflow-hidden rounded-[16px] border border-[#1d4690]/70 bg-white">
                  <img src={previa} alt="Ticket escolhido" className="max-h-[300px] w-full object-contain" />
                  <button
                    type="button"
                    onClick={limparFoto}
                    aria-label="Tirar a foto"
                    className="absolute top-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="foto-ticket"
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-[#2f8cf0]/60 bg-[#0b2152]/50 px-4 py-6 text-center transition-colors hover:border-ciano/70"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_24px_-4px_rgba(47,140,240,0.8)]">
                    <ImageIcon size={26} />
                  </span>
                  <span className="font-display text-[17px] font-extrabold text-white">
                    Escolher foto
                  </span>
                  <span className="text-[13px] text-gelo/75">
                    Tire a foto ou escolha o ticket na galeria
                  </span>
                </label>
              )}
            </Bloco>

            {/* texto */}
            <Bloco>
              <label htmlFor="texto-ticket" className="font-display text-[15px] font-extrabold tracking-[0.03em] text-white uppercase">
                Texto reconhecido ou digitado
              </label>
              <p className="mt-1 text-[12.5px] text-gelo/70">
                A leitura da foto aparece aqui. Se algum número sair errado, corrija e calcule de novo.
              </p>
              <textarea
                id="texto-ticket"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={"Quant    Valor\n27.120   21.52\n24.860   19.20\n27.500   17.93"}
                className="tabular mt-2 w-full resize-y rounded-[14px] border-[1.5px] border-[#1d4690]/80 bg-[#06122b]/80 px-3.5 py-3 font-mono text-[13.5px] leading-relaxed text-white outline-none placeholder:text-gelo/35 focus:border-ciano/70"
              />
            </Bloco>

            {/* porcentagem */}
            <Bloco>
              <div className="flex items-end justify-between">
                <span className="font-display text-[15px] font-extrabold tracking-[0.03em] text-white uppercase">
                  Porcentagem
                </span>
                <span className="tabular font-display text-[30px] leading-none font-black text-ouro">
                  {pct ? `${num(pct)}%` : "—"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {PORCENTAGENS.map((v) => {
                  const ativo = pct === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPorcentagem(String(v))}
                      aria-pressed={ativo}
                      className={`rounded-[14px] py-3 font-display text-[16px] font-black transition-transform active:scale-95 ${
                        ativo
                          ? "ouro"
                          : "border border-[#1d4690]/80 bg-[#06122b]/80 text-white hover:border-ciano/60"
                      }`}
                    >
                      {v}%
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-[14px] border-[1.5px] border-[#1d4690]/80 bg-[#06122b]/80 px-4 py-3 focus-within:border-ciano/70">
                <input
                  value={porcentagem}
                  onChange={(e) => setPorcentagem(e.target.value)}
                  inputMode="decimal"
                  aria-label="Outra porcentagem"
                  placeholder="Outro valor..."
                  className="tabular flex-1 bg-transparent font-display text-[16px] font-black text-white outline-none placeholder:text-gelo/40"
                />
                <span className="font-black text-gelo/70">%</span>
              </div>
            </Bloco>

            {/* calcular */}
            <button
              type="button"
              disabled={!podeCalcular}
              onClick={() => void executar()}
              className="ouro flex h-[56px] w-full items-center justify-center gap-2 rounded-full font-display text-[18px] font-extrabold tracking-[0.04em] uppercase disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Calculator size={21} strokeWidth={2.6} />
              {calculando ? "Calculando…" : "Calcular"}
            </button>

            {(calculando || status) && (
              <div className="space-y-1.5 px-1">
                <div className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-gelo/80">
                  <span className="truncate">{status}</span>
                  {calculando && <span className="tabular shrink-0">{progresso}%</span>}
                </div>
                {calculando && (
                  <div className="h-2 overflow-hidden rounded-full bg-[#06122b]">
                    <motion.div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#2f8cf0,#6fe7df)]"
                      animate={{ width: `${Math.max(progresso, 6)}%` }}
                      transition={{ duration: 0.25 }}
                    />
                  </div>
                )}
              </div>
            )}

            {erro && (
              <p className="flex items-start gap-2 rounded-[16px] border border-red-400/50 bg-red-500/10 px-4 py-3 text-[14px] text-red-200">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" /> {erro}
              </p>
            )}

            {/* resultado */}
            <AnimatePresence>
              {resultado && (
                <motion.div
                  ref={resultadoRef}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="scroll-mt-4"
                >
                  <Bloco>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-[16px] font-extrabold tracking-[0.04em] text-white uppercase">
                        Resultado
                      </h2>
                      {resultado.ponto && (
                        <span className="rounded-full border border-ciano/50 px-3 py-1 font-display text-[14px] font-bold text-ciano">
                          Ponto {resultado.ponto}
                        </span>
                      )}
                    </div>

                    {conferencia && (
                      <p
                        className={`mb-3 flex items-start gap-2 rounded-[14px] border px-3.5 py-2.5 text-[13.5px] ${
                          conferencia.ok
                            ? "border-verde/50 bg-verde/10 text-verde"
                            : "border-ambar/50 bg-ambar/10 text-ambar"
                        }`}
                      >
                        {conferencia.ok ? (
                          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                        ) : (
                          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                        )}
                        {conferencia.ok
                          ? `Confere com o ticket: ${conferencia.viagens} viagens · ${toneladas(conferencia.tons)} t.`
                          : `O ticket diz ${conferencia.viagens} viagens · ${toneladas(conferencia.tons)} t, mas a leitura achou ${resultado.cargas.length} · ${toneladas(resultado.toneladas)} t. Confira o texto acima.`}
                      </p>
                    )}

                    {problemas.length > 0 && (
                      <div className="mb-3 rounded-[14px] border border-ambar/50 bg-ambar/10 px-3.5 py-2.5 text-[13.5px] text-ambar">
                        <p className="flex items-center gap-2 font-bold">
                          <AlertTriangle size={17} className="shrink-0" />
                          {problemas.length} linha{problemas.length > 1 ? "s" : ""} ficou de fora
                          (valor ilegível na foto):
                        </p>
                        <ul className="tabular mt-1.5 list-disc space-y-0.5 pl-6 text-[13px]">
                          {problemas.map((pr) => (
                            <li key={pr}>{pr}</li>
                          ))}
                        </ul>
                        <p className="mt-1.5 text-[12.5px] text-ambar/90">
                          Corrija esses valores no texto acima e toque em Calcular de novo.
                        </p>
                      </div>
                    )}

                    <Resumo c={resultado} />

                    <button
                      type="button"
                      onClick={() => compartilhar(resultado)}
                      className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#25d366] font-display text-[16px] font-extrabold text-[#062b14] shadow-[0_10px_28px_-12px_rgba(37,211,102,0.9)]"
                    >
                      <Share2 size={19} /> Compartilhar no WhatsApp
                    </button>
                  </Bloco>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ================================================= HISTÓRICO */}
        {aba === "historico" && !aberto && (
          <div className="mt-3 space-y-3">
            <section className="cartao-monitor rounded-[24px] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-semibold text-gelo/85">Total acumulado</div>
                  <div className="tabular mt-1 font-display text-[clamp(30px,9vw,42px)] leading-none font-black text-ouro">
                    {brl(acumulado)}
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-gelo/70">
                    Ganhos salvos neste aparelho · {historico.length} cálculo
                    {historico.length === 1 ? "" : "s"}
                  </div>
                </div>
                {historico.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Excluir todo o histórico de cálculos?")) salvarHistorico([]);
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-400/45 px-3 py-2 text-[13px] font-semibold text-red-300 hover:bg-red-400/10"
                  >
                    <Trash2 size={14} /> Excluir tudo
                  </button>
                )}
              </div>
            </section>

            {historico.length === 0 ? (
              <Bloco className="py-8 text-center">
                <History size={32} className="mx-auto text-gelo/40" />
                <p className="mt-2 font-display text-[16px] font-bold text-white">Nenhum ganho salvo</p>
                <p className="mt-1 text-[13.5px] text-gelo/70">Seus cálculos aparecem aqui</p>
              </Bloco>
            ) : (
              <ul className="space-y-2">
                {historico.map((c) => (
                  <li key={c.id}>
                    <div className="painel flex items-center gap-3 !rounded-[18px] px-3.5 py-3">
                      <button
                        type="button"
                        onClick={() => setAberto(c)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="tabular font-display text-[19px] font-extrabold text-ouro">
                            {brl(c.ganho)}
                          </div>
                          <div className="tabular text-[12.5px] text-gelo/75">
                            {dataHora(c.criadoEm)}
                            {c.ponto ? ` · ${c.ponto}` : ""} · {c.cargas.length} cargas ·{" "}
                            {num(c.porcentagem)}% de {brl(c.bruto)}
                          </div>
                        </div>
                        <ChevronRight size={20} className="shrink-0 text-azulclaro" />
                      </button>
                      <button
                        type="button"
                        aria-label="Excluir este cálculo"
                        onClick={() => salvarHistorico(historico.filter((h) => h.id !== c.id))}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-red-400/40 text-red-300 hover:bg-red-400/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {aba === "historico" && aberto && (
          <div className="mt-3 space-y-3">
            <button
              type="button"
              onClick={() => setAberto(null)}
              className="flex items-center gap-1 font-display text-[14px] font-bold text-azulclaro hover:text-ciano"
            >
              <ChevronLeft size={18} strokeWidth={2.6} /> Voltar ao histórico
            </button>
            <section className="cartao-monitor rounded-[24px] px-4 py-4">
              <div className="text-[14px] font-semibold text-gelo/85">Resumo da viagem · Você recebeu</div>
              <div className="tabular mt-1 font-display text-[clamp(34px,10vw,46px)] leading-none font-black text-ouro">
                {brl(aberto.ganho)}
              </div>
              <div className="tabular mt-2 text-[13px] text-gelo/75">
                {dataHora(aberto.criadoEm)}
                {aberto.ponto ? ` · Ponto ${aberto.ponto}` : ""}
              </div>
            </section>
            <Bloco>
              <Resumo c={aberto} />
              <button
                type="button"
                onClick={() => compartilhar(aberto)}
                className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#25d366] font-display text-[16px] font-extrabold text-[#062b14]"
              >
                <Share2 size={19} /> Compartilhar no WhatsApp
              </button>
            </Bloco>
          </div>
        )}
      </main>
    </div>
  );
}
