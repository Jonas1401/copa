import { eq, sql } from "drizzle-orm";
import { comBanco, db, temBancoConfigurado } from "@/db";
import { portalFila } from "@/db/schema";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";
import { LIVROS_DA_FILA, resumoDoLivro, type LivroDaFila, type LivroLido, type TipoDaFila } from "@/lib/portal-fila-parse";
import { esperaEntreLeiturasMs, intervaloStatusMs } from "@/lib/portal-situacao";

/**
 * A FILA DO PORTAL — de onde vêm o card principal (último escalado, pontos na
 * fila), a posição de cada ponto e os avisos de “perto da vez” e “na vez”.
 *
 * O quadro público foi desligado pela Copadubo. A fila agora é a aba “Fila” do
 * Portal do Motorista, que só abre com a sessão de um motorista. A leitura
 * pega carona na olhada do Status: quando a conta de um motorista acabou de
 * ser aberta e a fila guardada já pode ser relida, a mesma sessão abre a aba
 * Fila (um pedido a mais) e o resultado fica guardado AQUI, uma linha por
 * livro, para todos os motoristas do app. Com alguém com o app aberto, a aba é
 * relida também ENTRE as olhadas do Status (`intervaloDaFilaMs`), com a
 * sessão de quem leu por último.
 *
 * O que fica guardado é só a fila geral — os pontos de cada quadro, na ordem,
 * e o último escalado. Nada da conta de quem abriu a tela.
 *
 * Aqui ficam a configuração e o que está guardado. Quem abre a tela é o
 * `portal-copadubo` (`lerFilaNaSessaoGuardada`); quem decide a hora é o
 * `portal-monitor`; quem usa a fila é o `estado` (`varrer`).
 */

/* ------------------------------------------------------------ configuração */

export type FonteDaFila = "portal" | "quadro";

/**
 * De onde vem a fila. O padrão é `portal` (a aba “Fila” do Portal do
 * Motorista). `FONTE_FILA=quadro` volta à leitura do quadro público antigo —
 * que foi desligado; só serve se ele voltar a existir.
 */
export function fonteDaFila(): FonteDaFila {
  return (process.env.FONTE_FILA ?? "").trim().toLowerCase() === "quadro" ? "quadro" : "portal";
}

/**
 * Livros lidos na aba “Fila”. O padrão é só o Livro A. `PORTAL_FILA_LIVROS`
 * (ex.: `A,B,M`) acrescenta os outros — cada livro a mais é uma página a mais
 * por leitura.
 */
export function livrosDaFila(): LivroDaFila[] {
  const pedidos = (process.env.PORTAL_FILA_LIVROS ?? "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((x): x is LivroDaFila => (LIVROS_DA_FILA as readonly string[]).includes(x));
  const unicos = LIVROS_DA_FILA.filter((l) => pedidos.includes(l));
  return unicos.length ? unicos : ["A"];
}

/**
 * Por quanto tempo uma fila lida continua valendo sem uma leitura nova. Depois
 * disso o monitor fica OFFLINE (a fila antiga continua na tela, com a idade) e
 * nenhuma posição é conferida.
 */
export function validadeDaFilaMs(intervaloMs = intervaloStatusMs()): number {
  return Math.max(3 * 60_000, Math.round(2.5 * intervaloMs));
}

/** Depois de uma tentativa que não serviu, outra conta pode tentar em seguida. */
export const ESPERA_APOS_FALHA_DA_FILA_MS = 20_000;

/** De quanto em quanto tempo a fila é relida com o app aberto, se nada for configurado. */
export const INTERVALO_DA_FILA_PADRAO_S = 20;
/** Folga da reserva: o pedido do app (um a cada 5 s) nunca cai exatamente em cima da marca. */
export const FOLGA_DA_FILA_MS = 2_000;

/**
 * A fila ENTRE as olhadas do Status. Com alguém com o app aberto, a aba “Fila”
 * é aberta de novo sem esperar o próximo ciclo de 1 minuto: um pedido, com a
 * sessão de quem leu por último, sem login (`atualizarFilaEntreCiclos`).
 *
 * `PORTAL_FILA_INTERVALO_S` (10 a 60 segundos) diz de quanto em quanto tempo.
 * `0` ou `desligado` volta a ler a fila só na carona do Status, uma vez por
 * ciclo — é a chave de retorno se o portal reclamar de tantas consultas. Um
 * intervalo que não seja menor que a espera do próprio Status também desliga:
 * a carona já lê nesse ritmo.
 *
 * Devolve `null` quando a leitura entre ciclos está desligada.
 */
export function intervaloDaFilaMs(esperaDoStatusMs = esperaEntreLeiturasMs()): number | null {
  const bruto = (process.env.PORTAL_FILA_INTERVALO_S ?? "").trim().toLowerCase();
  if (["0", "desligado", "desligada", "off", "nao", "não"].includes(bruto)) return null;
  const pedido = Number(bruto);
  const segundos = bruto !== "" && Number.isFinite(pedido) && pedido >= 10 && pedido <= 60 ? Math.round(pedido) : INTERVALO_DA_FILA_PADRAO_S;
  return segundos * 1000 < esperaDoStatusMs ? segundos * 1000 : null;
}

/**
 * Quanto a próxima abertura da aba “Fila” espera depois de uma reserva. Com a
 * leitura entre ciclos ligada é o intervalo dela (menos a folga); desligada, é
 * a espera do Status, como sempre foi. Vale para toda reserva — a da carona
 * também: assim a fila fica livre para ser relida logo depois dela.
 */
export function esperaDaFilaMs(): number {
  const intervalo = intervaloDaFilaMs();
  return intervalo === null ? esperaEntreLeiturasMs() : Math.max(5_000, intervalo - FOLGA_DA_FILA_MS);
}

/* ------------------------------------------------------------ o que guarda */

export type QuadroGuardado = { ultimo: number; codigos: number[] };
export type DadosDaFila = Record<TipoDaFila, QuadroGuardado>;

export type FilaGuardada = {
  livro: LivroDaFila;
  /** Os dois quadros do livro (null = este livro nunca foi lido). */
  dados: DadosDaFila | null;
  lidoEm: Date | null;
  motoristaId: number | null;
  tentativaEm: Date | null;
  erro: string | null;
  diagnostico: string[];
};

const inteiros = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 999) ? (v as number[]) : null;

/** Confere o que saiu do banco: um valor estragado nunca vira fila. */
function quadroValido(v: unknown): QuadroGuardado | null {
  if (!v || typeof v !== "object") return null;
  const { ultimo, codigos } = v as { ultimo?: unknown; codigos?: unknown };
  const lista = inteiros(codigos);
  if (!lista || !Number.isInteger(ultimo) || (ultimo as number) < 0 || (ultimo as number) > 999) return null;
  return { ultimo: ultimo as number, codigos: lista };
}

function dadosValidos(v: unknown): DadosDaFila | null {
  if (!v || typeof v !== "object") return null;
  const truck = quadroValido((v as Record<string, unknown>).TRUCK);
  const cavalo = quadroValido((v as Record<string, unknown>).CAVALO);
  return truck && cavalo ? { TRUCK: truck, CAVALO: cavalo } : null;
}

const linhasDe = (texto: string | null) => (texto ? texto.split("\n").filter(Boolean) : []);

/** O que está guardado de cada livro (lido ou só tentado). */
export async function filaGuardada(): Promise<FilaGuardada[]> {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  const linhas = await comBanco(() => db.select().from(portalFila));
  return linhas
    .filter((l): l is typeof l & { livro: LivroDaFila } => (LIVROS_DA_FILA as readonly string[]).includes(l.livro))
    .map((l) => {
      const dados = dadosValidos(l.dados);
      return {
        livro: l.livro,
        dados,
        lidoEm: dados ? l.lidoEm : null,
        motoristaId: l.motoristaId,
        tentativaEm: l.tentativaEm,
        erro: l.erro,
        diagnostico: linhasDe(l.diagnostico),
      };
    });
}

/**
 * Reserva os livros cuja leitura já pode começar e marca a próxima para daqui
 * a `esperaMs`. A reserva é atômica: duas funções rodando juntas (cron + app
 * aberto, ou dois motoristas lidos no mesmo instante) nunca abrem a fila do
 * mesmo livro ao mesmo tempo. `forcar` (alguém tocou em “Ler agora”) não
 * espera a hora, mas marca a reserva do mesmo jeito.
 */
export async function reservarLivrosDaFila(
  livros: LivroDaFila[],
  opcoes: { esperaMs?: number; forcar?: boolean } = {},
): Promise<LivroDaFila[]> {
  if (!temBancoConfigurado || !livros.length) return [];
  await garantirTabelasPortal();
  const espera = Math.max(5_000, Math.round(opcoes.esperaMs ?? esperaDaFilaMs()));
  const reservados: LivroDaFila[] = [];
  for (const livro of livros) {
    await comBanco(() => db.insert(portalFila).values({ livro }).onConflictDoNothing());
    const linhas = await comBanco(() =>
      db
        .update(portalFila)
        .set({ proximaLeituraEm: sql`now() + (${espera} * interval '1 millisecond')`, tentativaEm: sql`now()` })
        .where(
          opcoes.forcar
            ? eq(portalFila.livro, livro)
            : sql`${portalFila.livro} = ${livro} and (${portalFila.proximaLeituraEm} is null or ${portalFila.proximaLeituraEm} <= now())`,
        )
        .returning({ livro: portalFila.livro }),
    );
    if (linhas.length) reservados.push(livro);
  }
  return reservados;
}

/** Uma fila com mais pontos do que isto não fica vazia de uma leitura para a outra… */
export const FILA_QUE_NAO_SOME = 8;
/** …enquanto a leitura anterior tiver até este tempo. Depois, vale o que a tela mostra. */
export const PRAZO_DA_FILA_QUE_SOME_MS = 10 * 60_000;

/**
 * Última conferência antes de guardar: um quadro que tinha muitos pontos na
 * leitura anterior (de poucos minutos atrás) e agora vem VAZIO não é aceito —
 * é mais provável uma tela que veio pela metade ou mudou de formato do que 9
 * ou mais pontos escalados no mesmo minuto. Aceitar daria todos esses pontos
 * como “saiu da fila”. A recusa dura no máximo `PRAZO_DA_FILA_QUE_SOME_MS`:
 * se a fila esvaziou mesmo, a leitura passa a valer depois disso.
 */
export function motivoDaFilaSumida(
  anterior: Pick<FilaGuardada, "dados" | "lidoEm"> | null | undefined,
  lido: LivroLido,
  agora = Date.now(),
): string | null {
  if (!anterior?.dados || !anterior.lidoEm) return null;
  const idade = agora - anterior.lidoEm.getTime();
  if (idade > PRAZO_DA_FILA_QUE_SOME_MS) return null;
  const quadros = [
    ["Truck", anterior.dados.TRUCK, lido.truck],
    ["Carreta", anterior.dados.CAVALO, lido.cavalo],
  ] as const;
  for (const [nome, antes, novo] of quadros) {
    if (novo.codigos.length === 0 && antes.codigos.length > FILA_QUE_NAO_SOME) {
      const minutos = Math.max(1, Math.round(idade / 60_000));
      return `o quadro ${nome} tinha ${antes.codigos.length} pontos há ${minutos} min e agora veio ${novo.ausente ? "fora da tela" : "vazio"}: leitura não aceita (se a fila esvaziou mesmo, passa a valer em até ${Math.round(PRAZO_DA_FILA_QUE_SOME_MS / 60_000)} min)`;
    }
  }
  return null;
}

/** Guarda a fila que acabou de ser lida (os dois quadros do livro). */
export async function guardarFilaLida(livro: LivroDaFila, lido: LivroLido, motoristaId: number, diagnostico: string[] = []) {
  const dados: DadosDaFila = {
    TRUCK: { ultimo: lido.truck.ultimo, codigos: lido.truck.codigos },
    CAVALO: { ultimo: lido.cavalo.ultimo, codigos: lido.cavalo.codigos },
  };
  const texto = [`Livro ${livro}: ${resumoDoLivro(livro, lido)}.`, ...diagnostico].join("\n").slice(0, 2_000);
  await comBanco(() =>
    db
      .update(portalFila)
      .set({ dados, lidoEm: new Date(), motoristaId, tentativaEm: new Date(), erro: null, diagnostico: texto })
      .where(eq(portalFila.livro, livro)),
  );
  return dados;
}

/**
 * A tentativa não serviu: guarda o motivo (para o painel) e libera outra
 * tentativa para daqui a pouco. A última fila boa continua guardada.
 */
export async function registrarFalhaDaFila(livro: LivroDaFila, erro: string, motoristaId: number, diagnostico: string[] = []) {
  await comBanco(() =>
    db
      .update(portalFila)
      .set({
        erro: erro.slice(0, 300),
        diagnostico: diagnostico.join("\n").slice(0, 2_000),
        motoristaId,
        tentativaEm: sql`now()`,
        proximaLeituraEm: sql`now() + (${ESPERA_APOS_FALHA_DA_FILA_MS} * interval '1 millisecond')`,
      })
      .where(eq(portalFila.livro, livro)),
  );
}

/* --------------------------------------------------- painel do administrador */

export type ResumoDaFila = {
  fonte: FonteDaFila;
  livros: {
    livro: LivroDaFila;
    /** Hora da última leitura BOA (null = nunca leu). */
    lidoEm: string | null;
    /** A leitura ainda vale (ver `validadeDaFilaMs`). */
    recente: boolean;
    truck: { naFila: number; ultimo: number } | null;
    carreta: { naFila: number; ultimo: number } | null;
    /** Por que a última tentativa não serviu (null = serviu). */
    erro: string | null;
    tentativaEm: string | null;
    motoristaId: number | null;
    diagnostico: string[];
  }[];
};

/** Para o cartão do /admin: o que a aba “Fila” trouxe e, se falhou, por quê. */
export async function resumoDaFila(): Promise<ResumoDaFila> {
  const fonte = fonteDaFila();
  if (!temBancoConfigurado || fonte !== "portal") return { fonte, livros: [] };
  const guardadas = await filaGuardada().catch(() => [] as FilaGuardada[]);
  const agora = Date.now();
  return {
    fonte,
    livros: livrosDaFila().map((livro) => {
      const g = guardadas.find((x) => x.livro === livro);
      return {
        livro,
        lidoEm: g?.lidoEm?.toISOString() ?? null,
        recente: Boolean(g?.lidoEm && agora - g.lidoEm.getTime() <= validadeDaFilaMs()),
        truck: g?.dados ? { naFila: g.dados.TRUCK.codigos.length, ultimo: g.dados.TRUCK.ultimo } : null,
        carreta: g?.dados ? { naFila: g.dados.CAVALO.codigos.length, ultimo: g.dados.CAVALO.ultimo } : null,
        erro: g?.erro ?? null,
        tentativaEm: g?.tentativaEm?.toISOString() ?? null,
        motoristaId: g?.motoristaId ?? null,
        diagnostico: g?.diagnostico ?? [],
      };
    }),
  };
}
