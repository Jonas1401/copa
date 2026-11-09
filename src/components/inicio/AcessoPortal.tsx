"use client";

import { ChevronRight, KeyRound, Radio } from "lucide-react";

/**
 * Acesso VISÍVEL ao Portal do motorista na tela inicial.
 *
 * O cadastro do CPF/senha também está no menu ⋮, mas lá ninguém acha: este
 * cartão fica na própria tela de Início, logo acima de “Serviços”, com o
 * estado do monitoramento (cadastrado? última leitura? precisa reenviar a
 * senha?) para o motorista saber que existe e o que fazer.
 */
export default function AcessoPortal({
  onAbrir,
  estado,
}: {
  onAbrir: () => void;
  /**
   * Resumo do que já está cadastrado (null = ainda carregando/no banco).
   * Vem de `/api/portal` — nunca traz CPF completo nem senha.
   */
  estado?: {
    cadastrado: boolean;
    cpfMascarado: string | null;
    leitura: { ok: boolean; loginRecusado: boolean; captcha: boolean; totalLinhas: number; quando: string | null } | null;
  } | null;
}) {
  const cadastrado = Boolean(estado?.cadastrado);
  const leitura = estado?.leitura ?? null;

  const situacao = !cadastrado
    ? "Cadastre seu CPF e a senha do portal (uma vez só)"
    : leitura?.loginRecusado
      ? "O portal recusou a senha: cadastre de novo"
      : leitura?.captcha
        ? "O portal pediu captcha — vou continuar tentando"
        : leitura?.ok
          ? `Lendo sua página do portal · ${leitura.totalLinhas} linha(s)`
          : "Monitorando — aguardando a próxima leitura";

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-center gap-3 rounded-[20px] border-[1.5px] border-[#183341] bg-[#071A28] p-3.5 text-left transition-transform active:scale-[0.99]"
    >
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#00B8BC] text-white shadow-[0_0_22px_-4px_rgba(0,184,188,0.8)]">
        <KeyRound size={21} strokeWidth={2.2} />
        {cadastrado && (
          <span
            aria-hidden
            className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#071A28] ${
              leitura?.ok ? "bg-[#00C853]" : leitura?.loginRecusado ? "bg-red-400" : "bg-ouro"
            }`}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[clamp(15px,4.3vw,17px)] leading-tight font-extrabold text-white">
          Portal do motorista
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-gelo/80">{situacao}</span>
        {cadastrado && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#00B8BC]">
            <Radio size={12} /> status do ponto, fila e dispensa
          </span>
        )}
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-white/70 text-white">
        <ChevronRight size={17} strokeWidth={2.4} />
      </span>
    </button>
  );
}
