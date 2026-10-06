/**
 * Velocidade de reprodução dos áudios do chat dos motoristas.
 *
 * O player dos recados de voz toca em 1× (normal), 1,5× ou 2×. A escolha é
 * feita no próprio player (toca na etiqueta "1,5x"/"2x" e a velocidade passa
 * para a próxima, em ciclo), vale também para os próximos áudios e fica
 * lembrada no aparelho (localStorage).
 *
 * Nada muda no servidor nem no banco: a velocidade é só de quem está
 * ouvindo — cada motorista ouve no ritmo que preferir.
 */

export const VELOCIDADES_AUDIO = [1, 1.5, 2] as const;

export type VelocidadeAudio = (typeof VELOCIDADES_AUDIO)[number];

/** Onde o aparelho lembra a última velocidade escolhida. */
export const CHAVE_VELOCIDADE_AUDIO = "copalinks-audio-velocidade";

/** "1x", "1,5x", "2x" — vírgula decimal, como se escreve em português. */
export function rotuloVelocidade(velocidade: number): string {
  const valor = Number.isInteger(velocidade) ? String(velocidade) : String(velocidade).replace(".", ",");
  return `${valor}x`;
}

/** Próxima velocidade do ciclo 1× → 1,5× → 2× → 1×. */
export function proximaVelocidade(velocidade: number): VelocidadeAudio {
  const indice = VELOCIDADES_AUDIO.indexOf(velocidade as VelocidadeAudio);
  return VELOCIDADES_AUDIO[(indice + 1) % VELOCIDADES_AUDIO.length];
}

/**
 * Só aceita as velocidades da lista. Qualquer outra coisa (texto inválido,
 * valor antigo guardado no aparelho) volta para 1× em vez de quebrar o player.
 */
export function velocidadeValida(valor: unknown): VelocidadeAudio {
  const numero =
    typeof valor === "number" ? valor : Number(String(valor ?? "").trim().replace(",", "."));
  return VELOCIDADES_AUDIO.find((velocidade) => velocidade === numero) ?? 1;
}

type ElementoComPitch = HTMLMediaElement & {
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

/**
 * Aplica a velocidade no `<audio>` sem reiniciar: vale para o trecho que está
 * tocando agora e para os próximos. O tom da voz é preservado (nada de voz
 * acelerada de desenho), inclusive nos navegadores que só expõem a chave
 * com prefixo (Safari antigo).
 */
export function aplicarVelocidade(elemento: HTMLMediaElement, velocidade: number): void {
  const alvo = elemento as ElementoComPitch;
  try {
    alvo.defaultPlaybackRate = velocidade;
    alvo.playbackRate = velocidade;
    alvo.preservesPitch = true;
    alvo.webkitPreservesPitch = true;
  } catch {
    /* aparelho sem suporte a playbackRate: o áudio continua em 1× */
  }
}

/** Última velocidade escolhida neste aparelho (1× quando não há nada salvo). */
export function lerVelocidadeSalva(): VelocidadeAudio {
  if (typeof window === "undefined") return 1;
  try {
    return velocidadeValida(window.localStorage.getItem(CHAVE_VELOCIDADE_AUDIO));
  } catch {
    return 1;
  }
}

export function salvarVelocidade(velocidade: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE_VELOCIDADE_AUDIO, String(velocidade));
  } catch {
    /* navegação privada/quota cheia: só não lembra a escolha na próxima visita */
  }
}

/* --------------------------------------------------------------------------
 * Assinatura da preferência (useSyncExternalStore): todos os players do chat
 * mostram a mesma velocidade e trocam juntos, inclusive entre abas.
 * ------------------------------------------------------------------------ */

const ouvintes = new Set<() => void>();

function avisarOuvintes() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

/**
 * Liga um componente à velocidade do aparelho. `useSyncExternalStore` cuida de
 * renderizar 1× no servidor e de assumir a preferência no cliente.
 */
export function assinarVelocidade(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (typeof window === "undefined") {
    return () => {
      ouvintes.delete(ouvinte);
    };
  }
  // Trocar a velocidade em outra aba do app vale para esta também.
  const aoMudarEmOutraAba = (evento: StorageEvent) => {
    if (evento.key === null || evento.key === CHAVE_VELOCIDADE_AUDIO) avisarOuvintes();
  };
  window.addEventListener("storage", aoMudarEmOutraAba);
  return () => {
    ouvintes.delete(ouvinte);
    window.removeEventListener("storage", aoMudarEmOutraAba);
  };
}

/** Velocidade em vigor neste aparelho (snapshot lido a cada render). */
export function velocidadeAtual(): VelocidadeAudio {
  return lerVelocidadeSalva();
}

/** No servidor não existe aparelho: renderiza 1× e o cliente assume a escolha. */
export function velocidadeNoServidor(): VelocidadeAudio {
  return 1;
}

/** Passa para a próxima velocidade, salva no aparelho e avisa todos os players do chat. */
export function ciclarVelocidade(velocidade: number): VelocidadeAudio {
  const nova = proximaVelocidade(velocidade);
  salvarVelocidade(nova);
  avisarOuvintes();
  return nova;
}
