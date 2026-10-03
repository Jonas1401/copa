/**
 * Leitura do painel da APPA (SIMPORT® – Dashboard Meteoceanográfico) — tipos.
 *
 * O painel é lido SEMPRE pelo servidor, por vários métodos que se revezam
 * automaticamente (veja `leitor.ts`). Cada método produz o mesmo formato
 * interno (`PainelSimport`) e o restante do aplicativo só enxerga a leitura
 * normalizada (`LeituraAppa`), não importa por qual caminho ela chegou.
 */

/** Métodos de leitura, na ordem em que são tentados. */
export type MetodoLeitura = "api" | "html" | "playwright" | "ocr" | "composio";

/**
 * Ordem obrigatória do fallback: API → HTTP+HTML → navegador automático
 * (Playwright) → captura de tela + OCR. O Composio é só um método ADICIONAL,
 * tentado por último: nunca é o único responsável pela leitura.
 */
export const ORDEM_METODOS: readonly MetodoLeitura[] = ["api", "html", "playwright", "ocr", "composio"];

/** Nome que a tela mostra para cada método. */
export const ROTULO_METODO: Record<MetodoLeitura, string> = {
  api: "API",
  html: "HTML direto",
  playwright: "Navegador automático",
  ocr: "OCR",
  composio: "Composio",
};

/**
 * Métodos do caminho LEVE (o app aberto bate no radar e não pode esperar): só
 * pedidos HTTP diretos e rápidos. Navegador, OCR e Composio ficam para o cron.
 */
export const METODOS_LEVES: readonly MetodoLeitura[] = ["api", "html"];

export const ehMetodo = (v: unknown): v is MetodoLeitura =>
  typeof v === "string" && (ORDEM_METODOS as readonly string[]).includes(v);

/* --------------------------------------------------------------- painel */
/** O que o painel mostra, já em números (formato interno de todos os métodos). */
export type PainelSimport = {
  boletim: { dia: string; texto: string }[];
  chuva: { hora: string; mm: number; prob: number }[];
  vento: { hora: string; nos: number; direcao: string }[];
  mares: { hora: string; altura: number; tipo: "alta" | "baixa" }[];
  nascerSol: string | null;
  porSol: string | null;
  agora: {
    temperatura: number | null;
    sensacao: number | null;
    umidade: number | null;
    ventoNos: number | null;
    direcao: string | null;
    pressao: number | null;
  };
  /** Quando o próprio painel diz que atualizou os dados (ISO), se disser. */
  atualizadoEm?: string | null;
};

/** Informações além das tabelas, que só alguns métodos (API) conseguem dar. */
export type Sinais = {
  /** Chuva medida AGORA pela estação do porto (mm na hora); null = sem estação. */
  chuvaAgoraMm?: number | null;
  /** Horários (HH:MM) em que o modelo da APPA prevê chuva forte / tempestade. */
  chuvaForteHoras?: string[];
  tempestadeHoras?: string[];
  /** Alertas explícitos da fonte (ex.: boletim marcado como "tempo ruim"). */
  alertas?: string[];
};

/** O que cada método devolve ao orquestrador. */
export type SaidaMetodo = {
  painel: PainelSimport;
  sinais?: Sinais;
  /** Quando o dado foi atualizado na fonte (ISO), se o método souber. */
  atualizadoEm?: string | null;
  /** Quando o método achou os dados por outro caminho (ex.: o HTML descobriu a API). */
  metodoEfetivo?: MetodoLeitura;
  /** Resumo curto para o log ("chuva 12 · vento 12 · boletim 4"). */
  resumo: string;
};

/** Falha esperada de um método (vira uma linha do log e o fallback segue). */
export class ErroMetodo extends Error {
  constructor(
    mensagem: string,
    /** falhou = erro/timeout · vazio = respondeu sem dados · indisponivel = não existe neste ambiente */
    public tipo: "falhou" | "vazio" | "indisponivel" = "falhou",
  ) {
    super(mensagem);
    this.name = "ErroMetodo";
  }
}

/* ---------------------------------------------------------- normalizado */
export type AnaliseChuva = {
  /** 0 sem chuva · 1 fraca · 2 moderada · 3 forte (na hora atual). */
  nivelAgora: number;
  /** Pior nível previsto nas próximas 24 h. */
  nivelMax: number;
  mmMax: number;
  probMax: number;
  /** Primeiro horário com chuva (HH:MM) e primeiro com chuva forte. */
  horaInicio: string | null;
  horaForte: string | null;
  horaPico: string | null;
  chovendoAgora: boolean;
};

export type AnaliseVento = {
  nosAgora: number | null;
  nosMax: number;
  horaMax: string | null;
  direcaoMax: string | null;
  classe: "calmo" | "fraco" | "moderado" | "forte";
};

export type EventoTexto = { prevista: boolean; trecho: string | null; horario: string | null };

export type DetalhesLeitura = {
  painel: PainelSimport;
  chuva: AnaliseChuva;
  vento: AnaliseVento;
  chuvaForte: EventoTexto;
  tempestade: EventoTexto;
};

/**
 * FORMATO NORMALIZADO: é só isto que o resto do aplicativo (radar, tela do
 * administrador, notificações) consome — não importa se a leitura veio da
 * API, do HTML, do navegador automático, do OCR ou do Composio.
 */
export type LeituraAppa = {
  fonte: "APPA";
  /** Quando o CopaLinks leu o painel (ISO). */
  timestamp_leitura: string;
  /** Quando a fonte atualizou o dado (ISO), se ela informar. */
  atualizado_em: string | null;
  temperatura: string | null;
  sensacao_termica: string | null;
  chuva: string | null;
  chuva_forte: string | null;
  tempestade: string | null;
  vento: string | null;
  umidade: string | null;
  pressao: string | null;
  alertas: string[];
  status: "sucesso" | "parcial";
  metodo_leitura: MetodoLeitura;
  /** Números e tabelas já interpretados (usados pelo radar para comparar). */
  detalhes: DetalhesLeitura;
};

/** A leitura sem os detalhes internos: o que a tela e a API mostram. */
export type LeituraAppaPublica = Omit<LeituraAppa, "detalhes">;

export const leituraPublica = (l: LeituraAppa): LeituraAppaPublica => {
  const { detalhes: _detalhes, ...resto } = l;
  void _detalhes;
  return resto;
};

/* ------------------------------------------------------------ diagnóstico */
export type TentativaLeitura = {
  /** Posição na fila do ciclo (1 = primeiro método tentado). */
  ordem: number;
  metodo: MetodoLeitura;
  inicio: string;
  duracaoMs: number;
  resultado: "sucesso" | "parcial" | "falhou" | "vazio" | "indisponivel" | "pulado";
  detalhe: string;
  /** Linha pronta do log: "[09:15:02] APPA · API · sucesso · 812 ms · ...". */
  linha: string;
};

export type ResultadoLeitura = {
  /** erro = NENHUM método conseguiu ler o painel. */
  status: "sucesso" | "parcial" | "erro";
  leitura: LeituraAppa | null;
  metodo: MetodoLeitura | null;
  tentativas: TentativaLeitura[];
  /** Resumo de todas as falhas, só quando nenhum método funcionou. */
  erro: string | null;
  duracaoMs: number;
  /** Caminho leve (app aberto): só API e HTML foram tentados; o erro NÃO vale para todos os métodos. */
  leve?: boolean;
};
