/** Formato visível dos sites enviados pelo proprietário; dados estáticos de teste. */
export function atracadosTexto(opcoes: { eco?: string; aristos?: string; outro?: string } = {}) {
  const eco = opcoes.eco ?? "544,190";
  const aristos = opcoes.aristos ?? "41.792,880";
  return `COPALINKS — Navios Atracados
Atualizado 19:26:33
PARANAGUÁ
FOSPAR
1 operadora
AFFINITY DIVA
FOSPAR
FERTILIZ.MINER.QUIM.C/NITROGEN
Saldo da Operadora46.786,000 Tons.
Saldo Total do Navio46.786,000 Tons.
Berço 211
2 operadoras
ARISTOS II
ROCHA TERMINAIS PORTUARIOS E LOGISTICA S.A.
SULFATO DE AMONIO
Saldo da Operadora25.815,540 Tons.
HARBOR
SULFATO DE AMONIO
Saldo da Operadora15.977,340 Tons.
Saldo Total do Navio${aristos} Tons.
Berço 208
2 operadoras
ECO CERBERUS
ROCHA TERMINAIS PORTUARIOS E LOGISTICA S.A.
NITRATO DE AMONIO
Saldo da Operadora${opcoes.outro ?? "319,630"} Tons.
HARBOR
NITRATO DE AMONIO
Saldo da Operadora224,560 Tons.
Saldo Total do Navio${eco} Tons.`;
}

export function manobrasTexto(opcoes: { berco?: string; dataHora?: string; situacao?: string } = {}) {
  const detalhe = opcoes.berco ? `AT— Atracação: ${opcoes.berco}` : "EF— Entrada e Fundeio";
  return `# Manobras Previstas
SINPRAPAR — Fertilizantes
Em manobraAguardando manobraAtracado
ZY IDOL
UREIA
Desatracar
09/10 17:00·DS— Desatracação e Saída: PFELIX 2 BB
PREVISTA
AFENTIS XRISTOS ATH
UREIA
Atracar
${opcoes.dataHora ?? "11/10 17:00"}·${detalhe}
${opcoes.situacao ?? "PREVISTA"}
ORION GLOBE
SULFATO DE AMONIO
Atracar
12/10 17:00·EF— Entrada e Fundeio
PREVISTA
AFFINITY DIVA
FERTILIZ.MINER.QUIM.C/NITROGEN
Atracado
Desatracar
14/10 18:00·DS— Desatracação e Saída: FOSPAR EXT BB
PREVISTA`;
}
