/** Política do proprietário: somente avisos automáticos de navios no chat.
 * Não afeta mensagens dos motoristas, a fila, o visual ou perguntas à IA.
 * Não pode ser ignorada por `forcar` nem por variáveis antigas do clima.
 */
export const NOME_NAVIOS_AUTOMACAO = "🚢 Navios no Porto";
export const POLITICA_AUTOMACAO = Object.freeze({
  versao: 2,
  climaNoChat: false,
  regrasDePortoPorPush: false,
  boasVindasNoChat: false,
  limiteSaldoToneladas: 2000,
  fonteAtracados: "https://berth-bloom-buddy.lovable.app/",
  fonteManobras: "https://berth-bloom-tracker.lovable.app/",
});

export function sistemaPodePublicar(nome: string): boolean {
  return nome === NOME_NAVIOS_AUTOMACAO;
}

export function mensagemVisivelNoChat(m: { motoristaId: number; nome: string }): boolean {
  return m.motoristaId > 0 || sistemaPodePublicar(m.nome);
}

export const MEMORIA_POLITICA_PORTO = `Configuração permanente do CopaLinks:
O Composio lê as fontes públicas de navios atracados e de manobras previstas em segundo plano, sem modificar o visual do aplicativo.
Não publicar automaticamente previsão do tempo, dicas, regras de comportamento ou alertas de segurança do porto no chat ou por notificação. Esses assuntos continuam disponíveis para responder perguntas do motorista.
Avisos automáticos do chat: somente navios, manobras previstas, atracação e desatracação, um navio por mensagem e por notificação.
Saldo: usar Saldo Total do Navio, estritamente menor que 2.000 toneladas; avisar mudanças reais dos saldos, inclusive das operadoras quando o total do navio estiver abaixo desse limite.
Previsão de manobra: exigir berço definido e data prevista. Entrada e fundeio (EF) sem berço não é previsão de atracação. PREVISTA não significa CONFIRMADA nem manobra já realizada.
Preservar literalmente nomes, mercadorias, saldos e horários da fonte. Não arredondar, estimar, incluir maré, clima ou conselhos nos avisos automáticos.
Comparar leituras válidas, não repetir a mesma informação e nunca interpretar desaparecimento ou falha de leitura como desatracação.
Mensagens escritas pelos motoristas e notificações pessoais da fila continuam funcionando.`;
