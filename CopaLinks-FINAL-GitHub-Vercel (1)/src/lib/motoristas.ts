/** Nome limpo: sem espaços sobrando, 2 a 60 letras. */
export function limparNome(bruto: unknown) {
  const nome = String(bruto ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return nome.length >= 2 ? nome : null;
}

export type PontoInicial = { tipo: string; livro: string; numero: number };

export type Motorista = {
  id: number;
  nome: string;
  criadoEm: string;
  /** Ponto informado na 1ª abertura (null = cadastrou só o nome). */
  ponto: PontoInicial | null;
};

/** Chave do aparelho: quem é o motorista deste celular. */
export const CHAVE_MOTORISTA = "copalinks-motorista-v1";

export function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const a = partes[0]?.[0] ?? "?";
  const b = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (a + b).toUpperCase();
}

/** Aceita { tipo, livro, numero } válido; qualquer outra coisa vira null. */
export function limparPonto(bruto: unknown): PontoInicial | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const tipo = String(b.tipo ?? "").toUpperCase();
  const livro = String(b.livro ?? "").toUpperCase().replace("LIVRO ", "");
  const numero = Math.trunc(Number(b.numero));
  if (!["TRUCK", "CAVALO"].includes(tipo) || !["A", "B", "M"].includes(livro)) return null;
  if (!Number.isFinite(numero) || numero < 1 || numero > 999) return null;
  return { tipo, livro, numero };
}

/** Linha do banco → formato enviado ao app. */
export function paraMotorista(m: {
  id: number;
  nome: string;
  criadoEm: Date;
  pontoTipo: string | null;
  pontoLivro: string | null;
  pontoNumero: number | null;
}): Motorista {
  return {
    id: m.id,
    nome: m.nome,
    criadoEm: m.criadoEm.toISOString(),
    ponto:
      m.pontoTipo && m.pontoLivro && m.pontoNumero
        ? { tipo: m.pontoTipo, livro: m.pontoLivro, numero: m.pontoNumero }
        : null,
  };
}
