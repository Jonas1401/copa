/** Páginas de exemplo no MESMO formato da APPA e do SINPRAPAR (dados fictícios). */
type Linha = Record<string, string>;
const COLS: Record<string, string[]> = {
  ATRACADOS: ["Programação", "DUV", "Berço", "Embarcação", "IMO", "LOA", "DWT", "Bordo", "Sentido", "Agência", "Operador", "Mercadoria", "Atracação", "Chegada", "Janela Operacional", "Prancha (t/dia)", "Tons/Dia", "Previsto", "Realizado", "Saldo Operador", "Saldo Total"],
  PROGRAMADOS: ["Programação", "DUV", "Berço", "Embarcação", "IMO", "LOA", "Cal. Cheg.", "Cal. Saída", "DWT", "Bordo", "Sentido", "Agência", "Operador", "Mercadoria", "Chegada", "ETB", "Janela Operacional", "Prancha (t/dia)", "Previsto"],
  "AO LARGO": ["Programação", "DUV", "Berço", "Embarcação", "IMO", "LOA", "DWT", "Sentido", "Agência", "Operador", "Mercadoria", "ETA", "Chegada", "Janela Operacional", "Prancha (t/dia)", "Previsto", "Cal. Cheg.", "Cal. Saída"],
};
export function paginaAppa(secoes: Record<string, Linha[]>) {
  return `<html><body>${Object.entries(secoes).map(([s, linhas]) => {
    const cols = COLS[s];
    return `<table><tr><th colspan="20">${s}</th></tr><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>${linhas.map((l) => `<tr>${cols.map((c) => `<td>${l[c] ?? ""}</td>`).join("")}</tr>`).join("")}</table>`;
  }).join("")}<table><tr><th>LEGENDA</th></tr><tr><th>Sigla</th><th>Descrição</th><th>x</th><th>y</th></tr><tr><td>QB</td><td>Qualquer Bordo</td></tr></table></body></html>`;
}
export function paginaSinprapar(linhas: { data: string; hora: string; navio: string; manobra: string; calado: string; imo: string; situacao: string }[]) {
  const cab = ["Manobras Previstas Data", "Hora", "Navio", "Manobra", "Tipo", "LOA", "Boca", "Calado", "TBA", "DWT", "IMO", "Rebocadores", "Amarração", "Agência", "Bandeira", "Indicativo", "Fundeio na Barra", "Situação"];
  const tr = (c: string[]) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`;
  return `<table>${tr(cab)}${linhas.map((l) => tr([l.data, l.hora, l.navio, l.manobra, "GR", "189,99", "32,30", l.calado, "1", "55543", l.imo, "W CAM", "L", "AGENCIA", "PANAMA", "3EZE7", "", l.situacao])).join("")}</table>`;
}
