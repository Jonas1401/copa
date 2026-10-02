/** Conteúdo de boas-vindas ao novo motorista: mensagem do chat + notificação. */
export type ConteudoBoasVindas = {
  chat: string;
  tituloPush: string;
  corpoPush: string;
};

function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] || "novo parceiro";
}

function textoCurto(valor: unknown, limite: number) {
  if (typeof valor !== "string") return "";
  return valor.replace(/```(?:json)?/gi, "").replace(/\s+/g, " ").trim().replace(/^['"“”]+|['"“”]+$/g, "").slice(0, limite).trim();
}

/** Opção acolhedora garantida mesmo se o Composio estiver indisponível. */
export function boasVindasPadrao(nome: string): ConteudoBoasVindas {
  const primeiro = primeiroNome(nome);
  return {
    chat: `Alô, turma! 👋 ${primeiro} também chegou ao CopaLinks. Deixem um oi no chat e ajudem nosso novo parceiro a se sentir em casa! 🚛`,
    tituloPush: "👋 Chegou gente nova no CopaLinks!",
    corpoPush: `${primeiro} entrou para a turma. Abra o chat e mande um alô! 🚛`,
  };
}

/**
 * Lê e limita a resposta criativa do Composio. A IA nunca controla o formato
 * da notificação nem pode omitir o nome do recém-chegado.
 */
export function validarBoasVindasComposio(nome: string, resposta: string): ConteudoBoasVindas | null {
  const primeiro = primeiroNome(nome);
  let dados: Record<string, unknown> | null = null;
  const trechoJson = resposta.match(/\{[\s\S]*\}/)?.[0];
  if (trechoJson) {
    try {
      const valor: unknown = JSON.parse(trechoJson);
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        dados = valor as Record<string, unknown>;
      }
    } catch {
      // Algumas respostas vêm como uma frase em vez do JSON pedido abaixo.
    }
  }

  const chat = textoCurto(dados?.chat ?? resposta, 280);
  const tituloPush = textoCurto(dados?.tituloPush ?? dados?.titulo, 60);
  const corpoPush = textoCurto(dados?.corpoPush ?? dados?.notificacao, 200);
  const mencionaNome = (texto: string) => texto.toLocaleLowerCase("pt-BR").includes(primeiro.toLocaleLowerCase("pt-BR"));

  if (chat.length < 20 || !mencionaNome(chat)) return null;
  return {
    chat,
    tituloPush: tituloPush || "👋 Chegou gente nova no CopaLinks!",
    corpoPush: corpoPush && mencionaNome(corpoPush)
      ? corpoPush
      : boasVindasPadrao(nome).corpoPush,
  };
}
