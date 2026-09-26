"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, MapPin, User } from "lucide-react";

export type DadosBoasVindas = {
  nome: string;
  ponto: { tipo: string; livro: string; numero: number } | null;
};

/**
 * Tela da 1ª abertura do app: nome (obrigatório) e ponto (opcional).
 * Não fecha sem o nome — é ele que coloca o motorista na lista.
 */
export default function BoasVindas({
  enviando,
  erro,
  onEntrar,
}: {
  enviando: boolean;
  erro: string;
  onEntrar: (d: DadosBoasVindas) => void;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("CAVALO");
  const [livro, setLivro] = useState("A");
  const [numero, setNumero] = useState("");
  const campoNome = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => campoNome.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const nomeOk = nome.replace(/\s+/g, " ").trim().length >= 2;

  function entrar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nomeOk || enviando) return;
    const n = Number(numero);
    onEntrar({
      nome: nome.replace(/\s+/g, " ").trim(),
      ponto: numero && n >= 1 && n <= 999 ? { tipo, livro, numero: n } : null,
    });
  }

  const campo =
    "w-full appearance-none rounded-full border-[1.5px] border-[#2a5bb0]/80 bg-[#06122b]/85 px-4 py-3 font-display text-[16px] font-bold text-white outline-none transition-colors placeholder:font-medium placeholder:text-gelo/40 focus:border-ciano/80";

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-abismo">
      <img
        src="/images/porto-noite.webp"
        alt=""
        aria-hidden
        className="fixed inset-0 h-full w-full object-cover object-center"
      />
      <div className="fixed inset-0 bg-[linear-gradient(180deg,rgba(6,20,52,0.78)_0%,rgba(5,16,42,0.7)_40%,rgba(4,12,32,0.94)_100%)]" />

      <motion.form
        onSubmit={entrar}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative mx-auto flex min-h-full w-full max-w-[460px] flex-col justify-center px-5 py-8"
      >
        <img
          src="/images/copalinks-logo.webp"
          alt="CopaLinks"
          width={340}
          height={234}
          className="mx-auto h-auto w-[210px]"
        />
        <h1 className="mt-5 text-center font-display text-[clamp(26px,7.5vw,34px)] leading-tight font-extrabold text-white">
          Olá, <span className="text-ouro">Mestre!</span>
        </h1>
        <p className="mx-auto mt-2 max-w-[340px] text-center text-[15px] leading-relaxed text-gelo/85">
          Diga seu nome para entrar na lista de motoristas. Se quiser, já coloque
          seu ponto para o app começar a monitorar.
        </p>

        {/* nome */}
        <section className="cartao-monitor mt-6 rounded-[24px] p-4">
          <label htmlFor="bv-nome" className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[0.04em] text-white uppercase">
            <User size={19} className="text-azulclaro" /> Seu nome
          </label>
          <input
            ref={campoNome}
            id="bv-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            autoComplete="name"
            autoCapitalize="words"
            placeholder="Ex.: João Silva"
            className={`${campo} mt-2.5`}
          />
        </section>

        {/* ponto (opcional) */}
        <section className="mt-3 rounded-[24px] border-[1.5px] border-violeta/45 bg-[linear-gradient(180deg,rgba(40,22,86,0.88),rgba(22,14,56,0.92))] p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[0.04em] text-violeta uppercase">
              <MapPin size={19} className="fill-violeta text-[#1c1240]" /> Seu ponto
            </span>
            <span className="rounded-full border border-gelo/20 px-2.5 py-0.5 text-[12px] font-semibold text-gelo/75">
              opcional
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-[1fr_1fr_0.85fr] gap-2">
            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-bold tracking-[0.12em] text-gelo/75 uppercase">Tipo</span>
              <span className="relative block">
                <select className={`${campo} !px-3 !pr-7 !text-[14px]`} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="TRUCK">TRUCK</option>
                  <option value="CAVALO">CAVALO</option>
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-gelo/70" />
              </span>
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-bold tracking-[0.12em] text-gelo/75 uppercase">Livro</span>
              <span className="relative block">
                <select className={`${campo} !px-3 !pr-7 !text-[14px]`} value={livro} onChange={(e) => setLivro(e.target.value)}>
                  <option value="A">Livro A</option>
                  <option value="B">Livro B</option>
                  <option value="M">Livro M</option>
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-gelo/70" />
              </span>
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-bold tracking-[0.12em] text-gelo/75 uppercase">Número</span>
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                maxLength={3}
                placeholder="1"
                aria-label="Número do ponto (opcional)"
                className={`${campo} tabular !px-2 text-center !text-[15px]`}
              />
            </label>
          </div>
          <p className="mt-2 text-[12.5px] text-gelo/65">
            Pode deixar em branco e cadastrar depois, tocando no número do cartão.
          </p>
        </section>

        {erro && (
          <p className="mt-3 rounded-[16px] border border-red-400/50 bg-red-500/10 px-4 py-2.5 text-[14px] text-red-200">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={!nomeOk || enviando}
          className="ouro mt-5 flex h-[56px] w-full items-center justify-center rounded-full font-display text-[18px] font-extrabold tracking-[0.05em] uppercase disabled:cursor-not-allowed disabled:opacity-45"
        >
          {enviando ? "Entrando…" : numero ? "Entrar e monitorar" : "Entrar"}
        </button>
      </motion.form>
    </div>
  );
}
