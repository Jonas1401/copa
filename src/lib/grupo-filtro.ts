/**
 * Filtro das mensagens do grupo WhatsApp "INFO. OP PORTO / FOSPAR **".
 * Função pura (sem banco, sem rede): recebe o texto da mensagem e devolve os
 * códigos de cada lista. Quem decide quem recebe é o servidor, comparando o
 * código COMPLETO com os pontos cadastrados de cada motorista.
 *
 * Listas reconhecidas:
 *   "PONTOS NA VEZ"  → aviso "🔔 Ponto na vez nº A014"
 *   "... PULADAS:"   → aviso "⚠️ Ponto pulado nº A137"  (ex.: "TRUCADAS PULADAS:")
 *
 * Exemplo:
 *   PONTOS NA VEZ
 *   CARRETAS TRUCADAS (A):
 *   A014 - A016 - A017 ...
 *   TRUCADAS PULADAS:
 *   A137 - A140 - A144 ...
 */

export type ListaGrupo = "NA_VEZ" | "PULADO";

export type AnaliseGrupo = {
  /** Códigos formatados com 3 dígitos, na ordem da mensagem: ["A014", "A016"]. */
  naVez: string[];
  pulados: string[];
};

/** Tamanho máximo aceito (uma lista com centenas de códigos cabe folgada). */
export const TEXTO_MAX = 12_000;

/**
 * Código = letra do livro (A, B ou M) + EXATAMENTE 3 dígitos, isolado:
 * não pode ter letra/dígito colado antes nem depois. Assim "A014" nunca é
 * confundido com "A0145", "A01" não é reconhecido e placas ("ABC1234") são
 * ignoradas. Aceita um espaço opcional ("A 014").
 */
const CODIGO = /(?<![\p{L}\p{N}])([ABM]) ?(\d{3})(?![\p{L}\p{N}])/gu;

/**
 * Cabeçalhos de lista. A posição de cada um define a quem pertencem os códigos seguintes.
 * PULADOS só vale como TÍTULO de lista ("TRUCADAS PULADAS:", "CARRETAS PULADAS",
 * "PULADOS:"): a palavra solta numa conversa ("fui pulado, sou o A014",
 * "Pulado o A021?") não é lista e não pode gerar "Ponto pulado".
 */
const CABECALHOS: { lista: ListaGrupo; re: RegExp }[] = [
  { lista: "NA_VEZ", re: /(?<![\p{L}])PONTOS?\s+NA\s+VEZ(?![\p{L}])/giu },
  {
    lista: "PULADO",
    re: /(?<![\p{L}])(?:TRUCAD[AO]S?|CARRETAS?|TRUCKS?|PONTOS?|CAVALOS?|BITRENS?)\s+PULAD[OA]S?(?![\p{L}])|^[^\p{L}\p{N}]*PULAD[OA]S?(?=\s*(?::|$))/giu,
  },
];

/** Subtítulo de lista (tipo de veículo ou livro): continua dentro da lista atual. */
const SUBTITULO =
  /(?<![\p{L}])(?:CARRETAS?|TRUCAD[AO]S?|TRUCKS?|CAVALOS?|BITRENS?|RODOTRENS?|VANDERL[EÉ]IAS?|CA[CÇ]AMBAS?|GRANELEIROS?|LIVRO)(?![\p{L}])|\(\s*[ABM]\s*\)/u;
/** Mesmo padrão de CODIGO, sem a flag global (seguro para .test()). */
const TEM_CODIGO = new RegExp(CODIGO.source, "u");

export function formatarCodigo(livro: string, numero: number) {
  return `${livro.toUpperCase()}${String(numero).padStart(3, "0")}`;
}

/** "A014" → { livro: "A", numero: 14 }. Aceita só o formato exato. */
export function lerCodigo(codigo: string): { livro: "A" | "B" | "M"; numero: number } | null {
  const m = /^([ABM])(\d{3})$/.exec(codigo);
  if (!m) return null;
  const numero = Number(m[2]);
  return numero >= 1 ? { livro: m[1] as "A" | "B" | "M", numero } : null;
}

function codigosDaLinha(trecho: string) {
  const achados: { pos: number; codigo: string }[] = [];
  for (const m of trecho.matchAll(CODIGO)) {
    const numero = Number(m[2]);
    if (numero >= 1) achados.push({ pos: m.index ?? 0, codigo: formatarCodigo(m[1], numero) });
  }
  return achados;
}

/**
 * Lê a mensagem inteira, linha a linha:
 *  - "PONTOS NA VEZ" abre a lista principal; subtítulos como
 *    "CARRETAS TRUCADAS (A):" continuam dentro dela.
 *  - "... PULADAS:" abre a lista de pulados; linhas seguintes só com códigos
 *    continuam nela. Uma linha com outro título (texto) encerra os pulados e
 *    volta para a lista principal (se a mensagem tiver "PONTOS NA VEZ").
 *  - Códigos antes de qualquer cabeçalho são ignorados (mensagens comuns do
 *    grupo não geram aviso).
 */
export function analisarMensagemGrupo(texto: unknown): AnaliseGrupo {
  const vazio: AnaliseGrupo = { naVez: [], pulados: [] };
  if (typeof texto !== "string" || !texto.trim()) return vazio;
  const conteudo = texto.slice(0, TEXTO_MAX).toUpperCase();

  const naVez = new Set<string>();
  const pulados = new Set<string>();
  let principal: ListaGrupo | null = null;
  let atual: ListaGrupo | null = null;
  const guardar = (lista: ListaGrupo | null, codigo: string) => {
    if (lista === "NA_VEZ") naVez.add(codigo);
    else if (lista === "PULADO") pulados.add(codigo);
  };

  for (const linha of conteudo.split(/\r?\n/)) {
    const cabecalhos = CABECALHOS.flatMap(({ lista, re }) =>
      [...linha.matchAll(re)].map((m) => ({ pos: m.index ?? 0, lista })),
    ).sort((a, b) => a.pos - b.pos);
    const codigos = codigosDaLinha(linha);

    if (cabecalhos.length) {
      for (const c of codigos) {
        // Código pertence ao último cabeçalho que aparece antes dele na linha.
        const dono = [...cabecalhos].reverse().find((h) => h.pos < c.pos);
        guardar(dono ? dono.lista : atual, c.codigo);
      }
      atual = cabecalhos[cabecalhos.length - 1].lista;
      if (cabecalhos.some((h) => h.lista === "NA_VEZ")) principal = "NA_VEZ";
      continue;
    }

    // Outro título de lista ("CANCELADOS:") ou recado com códigos
    // ("OBS: A050 favor comparecer"): encerra a lista atual e ignora a linha,
    // para esses códigos não virarem "Ponto na vez". Subtítulos de veículo/
    // livro ("CARRETAS TRUCADAS (A):") e linhas informativas ("DATA: 28/09",
    // "ATUALIZADO 10:30") não encerram nada.
    const titulo = /^([^:]*\p{L}[^:]*?)\s*:(.*)$/u.exec(linha);
    if (
      titulo &&
      !SUBTITULO.test(titulo[1]) &&
      !/\d$/.test(titulo[1].trim()) &&
      !TEM_CODIGO.test(titulo[1]) &&
      (!titulo[2].trim() || TEM_CODIGO.test(titulo[2]))
    ) {
      atual = null;
      continue;
    }

    // Linha com outro texto (subtítulo ou recado) além dos códigos.
    const semCodigos = linha.replace(CODIGO, " ");
    if (/\p{L}{2,}/u.test(semCodigos) && atual === "PULADO") atual = principal;
    for (const c of codigos) guardar(atual, c.codigo);
  }

  return { naVez: [...naVez], pulados: [...pulados] };
}
