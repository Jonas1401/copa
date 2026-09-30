import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { amostras, eventos, pontos } from "@/db/schema";
import { notificarEvento } from "@/lib/push";
import { composioConfigurado, lerPaginas } from "@/lib/composio";

export type Tipo = "TRUCK" | "CAVALO";
export type Livro = "A" | "B" | "M";
export type StatusPonto = "AGUARDANDO" | "NA VEZ" | "SAIU";

export const TIPOS: Tipo[] = ["TRUCK", "CAVALO"];
export const LIVROS: Livro[] = ["A", "B", "M"];

export const ROTULO_TIPO: Record<Tipo, string> = {
  TRUCK: "TRUCK",
  CAVALO: "CAVALO/C",
};

export type LinhaFila = {
  tipo: Tipo;
  livro: Livro;
  naFila: number;
  ultimo: number;
  /** Fila a partir do ponto NA VEZ, na ordem do site (inclui a linha vermelha). */
  codigos: number[];
  /** Linhas destacadas em vermelho pelo site; a primeira é a da vez. */
  vermelhos: number[];
  /** Linhas já chamadas, anteriores ao ponto da vez, excluídas da fila. */
  ignorados: number;
  /** Quando o "Último Escalado" desta tabela mudou pela última vez. */
  ultimoDesde?: string | null;
  historico: number[];
};

export type FilaEstado = Record<string, LinhaFila>;

export type Snapshot = {
  /** intranet = leitura direta · composio = leitura de reserva pelo Composio */
  origem: "intranet" | "composio" | "offline";
  fila: FilaEstado;
  /** Quando esta tentativa de varredura foi gravada (com ou sem sucesso). */
  geradoEm: string;
  /**
   * Quando os dados desta fila foram REALMENTE lidos do site da Copadubo.
   * Numa tentativa que falhou (offline), conserva o horário da última
   * leitura boa. Snapshots antigos (antes deste campo) não o têm.
   */
  lidoEm?: string | null;
};

export type PontoDTO = {
  id: number;
  tipo: Tipo;
  livro: Livro;
  numero: number;
  codigo: string;
  rotulo: string;
  /** Número na fila, contando de 1 (o 1 é quem está na vez). */
  posicao: number;
  naFrente: number;
  status: StatusPonto;
  detalhe: string;
  vistoEm: string | null;
  chamadoEm: string | null;
  saidaEm: string | null;
  criadoEm: string;
  motoristaId: number | null;
};

export type EventoDTO = {
  id: number;
  codigo: string;
  acao: string;
  mensagem: string;
  criadoEm: string;
};

export type EstadoDTO = {
  /**
   * Horário da última leitura REAL do quadro da Copadubo (não da última
   * tentativa). É o que o contador "Atualizado há…" mostra.
   */
  atualizadoEm: string;
  /** false quando o servidor ainda não conseguiu ler o quadro nenhuma vez. */
  temLeitura: boolean;
  /** Relógio do servidor no momento da resposta: o app corrige o relógio do celular. */
  servidorAgora: string;
  origem: string;
  /** ONLINE = última leitura deu certo E não está velha (ver LEITURA_VELHA_MS). */
  online: boolean;
  fila: LinhaFila[];
  pontos: PontoDTO[];
  eventos: EventoDTO[];
  totalLeituras: number;
  tabelas: number;
  /** Links diretos para o quadro no site monitorado. */
  site: { geral: string; livros: Record<Livro, string> };
};

const chave = (tipo: string, livro: string) => `${tipo}:${livro}`;

export const codigoDe = (livro: string, numero: number) => `${livro}${numero}`;

/** Formato do site monitorado: A057, A115, M198. */
export const codigoFila = (livro: string, numero: number) =>
  `${livro}${String(numero).padStart(3, "0")}`;

/** Varredura do site a cada 5 segundos enquanto houver ponto monitorado. */
export const INTERVALO_VARREDURA = 4_500;

function baseFila(): FilaEstado {
  const fila: FilaEstado = {};
  const semente: Record<string, [number, number]> = {
    "TRUCK:A": [0, 115],
    "TRUCK:B": [20, 129],
    "TRUCK:M": [23, 123],
    "CAVALO:A": [39, 175],
    "CAVALO:B": [47, 119],
    "CAVALO:M": [43, 198],
  };
  for (const tipo of TIPOS) {
    for (const livro of LIVROS) {
      const [naFila, ultimo] = semente[chave(tipo, livro)];
      fila[chave(tipo, livro)] = {
        tipo,
        livro,
        naFila,
        ultimo,
        codigos: [],
        vermelhos: [],
        ignorados: 0,
        historico: [ultimo],
      };
    }
  }
  return fila;
}

function historicoDe(anterior: LinhaFila | undefined, ultimo: number) {
  const antes = anterior?.historico ?? [ultimo];
  return [ultimo, ...antes.filter((n) => n !== ultimo)].slice(0, 8);
}

// ------------------------------------------------------------- intranet
// Fonte monitorada: https://intranet.copadubo.com.br/ponto/
// A página é um frameset com pontoa.php / pontob.php / pontom.php (um quadro
// por livro). Cada quadro traz blocos "Livro A - TRUCK" / "Livro A - CARRETA"
// com "Último Escalado: A115" e a tabela com TODOS os pontos da fila.
const BASE_INTRANET =
  process.env.INTRANET_URL ?? "https://intranet.copadubo.com.br/ponto/";
const FRAMES: Record<Livro, string> = {
  A: "pontoa.php",
  B: "pontob.php",
  M: "pontom.php",
};

/** Mesmos endereços que a varredura lê: o quadro geral e o de cada livro. */
export function linksDoSite() {
  return {
    geral: BASE_INTRANET,
    livros: {
      A: new URL(FRAMES.A, BASE_INTRANET).toString(),
      B: new URL(FRAMES.B, BASE_INTRANET).toString(),
      M: new URL(FRAMES.M, BASE_INTRANET).toString(),
    } as Record<Livro, string>,
  };
}

type CacheRede = { valor: FilaEstado | null; em: number };
let cacheRede: CacheRede | null = null;
const VIDA_CACHE = 4_000;
let emAndamento: Promise<FilaEstado | null> | null = null;

/**
 * Momento (ms) em que os dados da última leitura boa saíram do site. Leitura
 * direta = quando o quadro respondeu; reserva Composio = quando o Composio
 * leu (pode ter até 1 min, pois é reaproveitada). O cache de 4 s NÃO renova
 * este horário: dado reaproveitado continua com a hora em que foi lido.
 */
let momentoUltimaLeitura = 0;

/** Leitura sem resposta do site por mais que isto: o monitor não é ONLINE. */
export const LEITURA_VELHA_MS = 2 * 60_000;

export async function lerIntranet(
  forcar = false,
): Promise<FilaEstado | null> {
  const agora = Date.now();
  if (!forcar && cacheRede && agora - cacheRede.em < VIDA_CACHE) {
    return cacheRede.valor;
  }

  // Uma busca por vez: varreduras simultâneas reaproveitam a promessa.
  if (!emAndamento) {
    emAndamento = buscarIntranet()
      .then((valor) => {
        cacheRede = { valor, em: Date.now() };
        return valor;
      })
      .catch(() => null)
      .finally(() => {
        emAndamento = null;
      });
  }
  return emAndamento;
}

/** De onde veio a última leitura boa (para a tela mostrar "reserva"). */
let fonteUltimaLeitura: "intranet" | "composio" = "intranet";

// Reserva pelo Composio: leva ~7 s e gasta créditos, então no máximo uma
// leitura por minuto (entre elas, reaproveita a última).
const INTERVALO_RESERVA = 60_000;
let reserva: { em: number; valor: FilaEstado | null } | null = null;

async function lerDireto(): Promise<FilaEstado | null> {
  const quadros = await Promise.all(
    LIVROS.map(async (livro) => {
      const url = new URL(FRAMES[livro], BASE_INTRANET).toString();
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      return res.ok ? await res.text() : "";
    }),
  );
  return parseQuadros(quadros);
}

async function lerPeloComposio(): Promise<FilaEstado | null> {
  if (reserva && Date.now() - reserva.em < INTERVALO_RESERVA) return reserva.valor;
  let valor: FilaEstado | null = null;
  try {
    if (await composioConfigurado()) {
      const urls = LIVROS.map((l) => new URL(FRAMES[l], BASE_INTRANET).toString());
      const paginas = await lerPaginas(urls, 30000);
      valor = parseMarkdownQuadros(paginas.map((p) => p.texto));
    }
  } catch {
    valor = null;
  }
  reserva = { em: Date.now(), valor };
  return valor;
}

async function buscarIntranet(): Promise<FilaEstado | null> {
  const direto = await lerDireto().catch(() => null);
  if (direto) {
    fonteUltimaLeitura = "intranet";
    momentoUltimaLeitura = Date.now();
    return direto;
  }
  const viaComposio = await lerPeloComposio();
  if (viaComposio) {
    fonteUltimaLeitura = "composio";
    momentoUltimaLeitura = reserva?.em ?? Date.now();
  }
  return viaComposio;
}

/**
 * Leitura de reserva: o Composio devolve cada quadro em markdown, com os
 * blocos na ordem do site (1º TRUCK, 2º CARRETA) e sem as cores das linhas.
 */
export function parseMarkdownQuadros(textos: string[]): FilaEstado | null {
  const fila = baseFila();
  const vistos = new Set<string>();
  textos.forEach((texto, i) => {
    const livro = LIVROS[i];
    if (!livro || !texto) return;
    const blocos = texto.split(/#+\s*Último\s+Escalado:/i).slice(1);
    blocos.slice(0, 2).forEach((bloco, j) => {
      const tipo: Tipo = j === 0 ? "TRUCK" : "CAVALO";
      const ult = bloco.match(/^\s*\**\s*([ABM])?\s*(\d{1,3})/i);
      // Não confie nas contagens fixas da baseFila quando um bloco da página
      // veio incompleto: isso produziria um falso "saiu" para pontos ativos.
      if (!ult || (ult[1] && ult[1].toUpperCase() !== livro)) return;
      const ultimo = Number(ult[2]);
      const linhas = [...bloco.matchAll(/\|\s*\d+\s*\|\s*([ABM])\s*(\d{1,3})\s*\|/gi)]
        .filter((m) => m[1].toUpperCase() === livro)
        .map((m) => Number(m[2]));
      // O Markdown não conserva o vermelho. Se o último escalado ainda está
      // na tabela, ele já foi chamado: o primeiro APÓS ele é o número 1.
      const codigos = ultimo ? linhas.filter((n) => n !== ultimo) : linhas;
      const k = chave(tipo, livro);
      fila[k] = {
        tipo,
        livro,
        naFila: codigos.length,
        ultimo,
        codigos,
        vermelhos: [],
        ignorados: linhas.length - codigos.length,
        historico: historicoDe(fila[k], ultimo),
      };
      vistos.add(k);
    });
  });
  // A reserva pelo Composio pode devolver apenas 1 ou 2 quadros. Nunca
  // interpretar os quadros ausentes como se estivessem vazios.
  return vistos.size === TIPOS.length * LIVROS.length ? fila : null;
}

export function parseQuadros(corpos: string[]): FilaEstado | null {
  const fila = baseFila();
  const vistos = new Set<string>();

  corpos.forEach((corpo, i) => {
    const livro = LIVROS[i];
    if (!livro || !corpo) return;

    for (const bloco of corpo.split(/<h2[^>]*>/i).slice(1)) {
      const cabecalho = bloco.match(/^\s*Livro\s*([ABM])\s*-\s*(TRUCK|CARRETA)/i);
      if (!cabecalho || cabecalho[1].toUpperCase() !== livro) continue;

      const tipo: Tipo =
        cabecalho[2].toUpperCase() === "TRUCK" ? "TRUCK" : "CAVALO";
      const ultimoM = bloco.match(
        /Último\s*Escalado:\s*<b>\s*([ABM])?\s*(\d{1,3})/i,
      );
      // HTTP 200 pode trazer HTML parcial. Não transformar quadros sem
      // "Último Escalado" ou sem tabela completa em uma fila vazia.
      if (!ultimoM || (ultimoM[1] && ultimoM[1].toUpperCase() !== livro) || !/<\/table\s*>/i.test(bloco)) continue;
      const ultimo = Number(ultimoM[2]);

      // Cada <tr> com ponto representa uma posição no quadro. A linha
      // vermelha é o ponto NA VEZ (posição 1), NÃO é um ponto descartado.
      // O "Último Escalado" do cabeçalho já foi chamado e pode ainda aparecer
      // acima dela: não deve contar como alguém na frente do número da vez.
      const linhas: { numero: number; vermelho: boolean }[] = [];
      for (const linha of bloco.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
        const html = linha[0];
        if (!/<td/i.test(html)) continue;
        const cod = html.match(/<h3>\s*([ABM])\s*(\d{1,3})/i);
        if (!cod || cod[1].toUpperCase() !== livro) continue;
        linhas.push({
          numero: Number(cod[2]),
          vermelho: /bgcolor\s*=\s*['"]?(#f{1,2}0{1,2}0{1,2}|red)/i.test(html),
        });
      }

      // Com destaque, começa exatamente no primeiro vermelho. Sem destaque,
      // começa após o último escalado (se ele ainda estiver listado).
      const primeiraVermelha = linhas.findIndex((l) => l.vermelho);
      const atuais = (primeiraVermelha >= 0 ? linhas.slice(primeiraVermelha) : linhas)
        .filter((l) => !ultimo || l.numero !== ultimo);
      const codigos = atuais.map((l) => l.numero);
      const vermelhos = atuais.filter((l) => l.vermelho).map((l) => l.numero);

      const k = chave(tipo, livro);
      fila[k] = {
        tipo,
        livro,
        naFila: codigos.length,
        ultimo,
        codigos,
        vermelhos,
        ignorados: linhas.length - codigos.length,
        historico: historicoDe(fila[k], ultimo),
      };
      vistos.add(k);
    }
  });

  // São três livros com dois quadros por livro. A ausência de qualquer um
  // torna esta leitura inválida, inclusive se os demais estão completos.
  return vistos.size === TIPOS.length * LIVROS.length ? fila : null;
}

// ------------------------------------------------------------- eventos
export async function registrarEvento(input: {
  codigo: string;
  tipo: string;
  livro: string;
  numero: number;
  acao: string;
  mensagem: string;
}) {
  await db.insert(eventos).values(input);
}

// ------------------------------------------------------------- varredura
/**
 * Varre os seis quadros. Só considera saída com a leitura completa: o ponto
 * virou Último Escalado ou já não aparece em nenhuma tabela do seu livro.
 * Um quadro parcial/offline nunca muda um ponto para SAIU.
 */
export async function varrer(
  opcoes: { forcarRede?: boolean } = {},
): Promise<Snapshot> {
  const [ultima] = await db
    .select()
    .from(amostras)
    .orderBy(desc(amostras.id))
    .limit(1);

  const anterior = (ultima?.dados as Snapshot | undefined)?.fila ?? null;
  const lido = await lerIntranet(opcoes.forcarRede);

  let fila: FilaEstado;
  const fonte = fonteUltimaLeitura;
  if (lido) {
    fila = lido;
    // O Composio devolve o texto sem cor. Conserva a informação visual da
    // última leitura direta quando possível, mas NUNCA retira o vermelho da
    // fila: ele é o número 1 e conta como alguém na frente do número 2.
    if (fonte === "composio" && anterior) {
      for (const k of Object.keys(fila)) {
        const verm = new Set(anterior[k]?.vermelhos ?? []);
        fila[k].vermelhos = fila[k].codigos.filter((n) => verm.has(n));
      }
    }
    const agoraIso = new Date().toISOString();
    for (const k of Object.keys(fila)) {
      const ant = anterior?.[k];
      fila[k].historico = historicoDe(ant, fila[k].ultimo);
      // Marca o momento em que o "Último Escalado" mudou no site. Sem leitura
      // anterior não dá para saber desde quando: fica null até a 1ª mudança.
      fila[k].ultimoDesde =
        ant && ant.ultimo !== fila[k].ultimo ? agoraIso : (ant?.ultimoDesde ?? null);
    }
  } else {
    // Sem resposta: mantém a última leitura e marca o monitor como offline.
    fila = anterior ?? baseFila();
  }

  // Horário da leitura REAL do site. Sem resposta agora, fica o horário da
  // última leitura boa (o contador da tela continua subindo, sem mentir).
  const snapAnterior = ultima?.dados as Snapshot | undefined;
  const lidoEm = lido
    ? new Date(momentoUltimaLeitura || Date.now()).toISOString()
    : lidoEmDe(snapAnterior);

  const snapshot: Snapshot = {
    origem: lido ? fonte : "offline",
    fila,
    geradoEm: new Date().toISOString(),
    lidoEm,
  };

  await db.insert(amostras).values({ origem: snapshot.origem, dados: snapshot });
  await db.execute(
    sql`delete from amostras where id < (select max(id) - 240 from amostras)`,
  );

  // A conferência só vale quando o site respondeu: sem leitura não se declara
  // que ninguém saiu.
  if (lido) await conferirPontos(fila);

  return snapshot;
}

/**
 * Horário da leitura real de um snapshot. Snapshots gravados antes do campo
 * `lidoEm` existir: se a leitura deu certo, geradoEm era o momento da leitura;
 * se era offline, não há como saber quando foi a última leitura boa.
 */
function lidoEmDe(s: Snapshot | undefined): string | null {
  if (!s) return null;
  if (s.lidoEm !== undefined) return s.lidoEm;
  return s.origem !== "offline" ? s.geradoEm : null;
}

/** Roda sem prender a resposta: só varre se a leitura estiver velha. */
export async function varrerSeVelho() {
  const [ultima] = await db
    .select()
    .from(amostras)
    .orderBy(desc(amostras.id))
    .limit(1);
  const idade = ultima ? Date.now() - ultima.criadoEm.getTime() : Infinity;
  if (idade > INTERVALO_VARREDURA) await varrer();
}

async function conferirPontos(fila: FilaEstado) {
  const todos = await db.select().from(pontos).orderBy(pontos.ordem, pontos.id);

  await Promise.all(
    todos.map(async (p) => {
      const codigo = codigoDe(p.livro, p.numero);
      let tipo = p.tipo as Tipo;

      // Quem é o número 1 (na vez) na tabela deste ponto, agora.
      const naVezAgora = () => {
        const topo = fila[chave(tipo, p.livro as Livro)]?.codigos[0];
        return topo ? codigoFila(p.livro, topo) : codigo;
      };
      let naFrenteAviso: number | undefined;
      const dispararPush = async (
        acao: "chamada" | "saiu" | "voltou" | "perto",
        codigoNaVez: string,
        saidaPorUltimo = false,
      ) => {
        // Na Vercel uma Promise sem await pode morrer assim que a resposta do
        // cron termina. Espera a entrega ao serviço de push antes de responder.
        try {
          await notificarEvento({
            acao,
            tipo,
            livro: p.livro as Livro,
            codigo,
            codigoNaVez,
            rotulo: ROTULO_TIPO[tipo],
            motoristaId: p.motoristaId ?? null,
            naFrente: naFrenteAviso,
            saidaPorUltimo,
          });
        } catch {
          // Nunca interrompe a atualização da fila por falha do serviço push.
          console.error("[monitor] Falha no envio de notificação", acao, codigo);
        }
      };

      // Índice real no quadro: linha vermelha = 0 (na vez); a linha seguinte
      // = 1 (um ponto na frente), independentemente de pular A184 → A187.
      // Se o ponto NA VEZ passou a ser o Último Escalado, sua saída já está
      // confirmada mesmo se o HTML antigo ainda deixar o número na tabela.
      const virouUltimo = p.status === "NA VEZ" &&
        fila[chave(tipo, p.livro as Livro)]?.ultimo === p.numero;
      let posicao = virouUltimo ? -1 : posicaoNaFila(fila, tipo, p.livro as Livro, p.numero);
      if (posicao < 0 && !virouUltimo) {
        // Não bateu? O mestre pode ter errado o tipo: confere a outra tabela
        // do mesmo livro antes de declarar que o ponto saiu.
        const outro: Tipo = tipo === "TRUCK" ? "CAVALO" : "TRUCK";
        const emOutro = posicaoNaFila(fila, outro, p.livro as Livro, p.numero);
        if (emOutro >= 0) {
          posicao = emOutro;
          tipo = outro;
          await db.update(pontos).set({ tipo }).where(eq(pontos.id, p.id));
          await registrarEvento({
            codigo,
            tipo,
            livro: p.livro,
            numero: p.numero,
            acao: "atualizou",
            mensagem: `${codigo} está na tabela de ${ROTULO_TIPO[tipo]} · tipo corrigido`,
          });
        }
      }

      if (posicao < 0) {
        // Só chega aqui com a leitura completa dos seis quadros. O número
        // saiu do quadro OU agora é o Último Escalado (último chamado).
        const saiuPorUltimo = fila[chave(tipo, p.livro as Livro)]?.ultimo === p.numero;
        if (p.status !== "SAIU") {
          const [alterado] = await db
            .update(pontos)
            .set({
              status: "SAIU",
              naFrente: 0,
              saidaEm: new Date(),
              chamadoEm: p.chamadoEm ?? new Date(),
            })
            .where(and(eq(pontos.id, p.id), ne(pontos.status, "SAIU")))
            .returning({ id: pontos.id });
          if (!alterado) return; // outro ciclo já notificou esta saída
          await registrarEvento({
            codigo,
            tipo,
            livro: p.livro,
            numero: p.numero,
            acao: "saiu",
            mensagem: saiuPorUltimo
              ? `${codigo} virou Último Escalado · saiu para o trabalho`
              : `${codigo} não está mais no quadro · saiu para o trabalho`,
          });
          await dispararPush("saiu", naVezAgora(), saiuPorUltimo);
        }
        return;
      }

      // posicao 0 = primeiro da fila = número 1 = quem está na vez.
      const status: StatusPonto = posicao === 0 ? "NA VEZ" : "AGUARDANDO";
      const numeroFila = posicao + 1;
      await db
        .update(pontos)
        .set({
          naFrente: posicao,
          status,
          vistoEm: new Date(),
          saidaEm: null,
          chamadoEm: posicao === 0 ? (p.chamadoEm ?? new Date()) : null,
        })
        .where(eq(pontos.id, p.id));

      if (p.status === "SAIU") {
        await registrarEvento({
          codigo,
          tipo,
          livro: p.livro,
          numero: p.numero,
            acao: "voltou",
            mensagem: `${codigo} voltou para a fila · número ${numeroFila}`,
          });
          await dispararPush("voltou", naVezAgora());
      } else if (
        p.alertaPerto != null &&
        posicao > 0 &&
        posicao <= p.alertaPerto &&
        (p.naFrente > p.alertaPerto || p.status !== "AGUARDANDO")
      ) {
        // Cruzou o limite do alerta agora (não repete enquanto continuar perto).
        await registrarEvento({
          codigo,
          tipo,
          livro: p.livro,
          numero: p.numero,
          acao: "perto",
          mensagem: `${codigo} está perto da vez · ${posicao} na frente`,
        });
        naFrenteAviso = posicao;
        await dispararPush("perto", naVezAgora());
      } else if (posicao === 0 && p.status !== "NA VEZ") {
        await registrarEvento({
          codigo,
          tipo,
          livro: p.livro,
          numero: p.numero,
          acao: "chamou",
          mensagem: `${codigo} é o número 1 da fila · na vez`,
        });
        await dispararPush("chamada", naVezAgora());
      }
    }),
  );
}

/** Índice zero = número 1 da vez; índice um = número 2, com 1 na frente. */
export function posicaoNaFila(
  fila: FilaEstado,
  tipo: Tipo,
  livro: Livro,
  numero: number,
) {
  const linha = fila[chave(tipo, livro)];
  return linha ? linha.codigos.indexOf(numero) : -1;
}

// ------------------------------------------------------------- montagem
export function paraDTO(p: typeof pontos.$inferSelect): PontoDTO {
  const codigo = codigoDe(p.livro, p.numero);
  const status = p.status as StatusPonto;
  const posicao = status === "SAIU" ? 0 : p.naFrente + 1;
  const detalhe =
    status === "SAIU"
      ? p.vistoEm
        ? "Chamado"
        : "Fora da tabela"
      : status === "NA VEZ"
        ? "na vez"
        : p.vistoEm
          ? `${p.naFrente} na frente`
          : "varrendo…";
  return {
    id: p.id,
    tipo: p.tipo as Tipo,
    livro: p.livro as Livro,
    numero: p.numero,
    codigo,
    rotulo: ROTULO_TIPO[p.tipo as Tipo],
    posicao,
    naFrente: p.naFrente,
    status,
    detalhe,
    vistoEm: p.vistoEm?.toISOString() ?? null,
    chamadoEm: p.chamadoEm?.toISOString() ?? null,
    saidaEm: p.saidaEm?.toISOString() ?? null,
    criadoEm: p.criadoEm.toISOString(),
    motoristaId: p.motoristaId ?? null,
  };
}

/** Leitura pura do banco: nenhuma rede, nenhuma escrita. */
/**
 * Estado para UM motorista: a fila do quadro (pública) e SÓ os pontos dele.
 * Cada motorista vê apenas os próprios números; sem motorista, nenhum ponto.
 */
export async function montarEstado(motoristaId: number | null): Promise<EstadoDTO> {
  const dono = Number.isInteger(motoristaId) && (motoristaId as number) > 0 ? (motoristaId as number) : null;
  const [ultimaAmostra, lista, contagens] = await Promise.all([
    db.select().from(amostras).orderBy(desc(amostras.id)).limit(1),
    dono === null
      ? Promise.resolve([] as (typeof pontos.$inferSelect)[])
      : db.select().from(pontos).where(eq(pontos.motoristaId, dono)).orderBy(pontos.ordem, pontos.id),
    db.select({ leituras: sql<number>`count(*)::int` }).from(amostras),
  ]);

  const ultima = ultimaAmostra[0];
  const snapshot = (ultima?.dados as Snapshot | undefined) ?? {
    origem: "offline" as const,
    fila: baseFila(),
    geradoEm: new Date().toISOString(),
  };

  const fila = TIPOS.flatMap((tipo) =>
    LIVROS.map((livro) => snapshot.fila[chave(tipo, livro)]),
  ).filter(Boolean);

  // O contador mostra a hora da leitura REAL do quadro, não da tentativa.
  // ONLINE só se a última tentativa leu o site e essa leitura não é velha.
  const agoraMs = Date.now();
  const lidoEm = ultima ? lidoEmDe(snapshot) : null;
  const idadeLeitura = lidoEm ? agoraMs - new Date(lidoEm).getTime() : Infinity;

  return {
    atualizadoEm: lidoEm ?? snapshot.geradoEm,
    temLeitura: Boolean(lidoEm),
    servidorAgora: new Date(agoraMs).toISOString(),
    origem: snapshot.origem,
    online: snapshot.origem !== "offline" && idadeLeitura <= LEITURA_VELHA_MS,
    // A interface usa contagens e último escalado; números individuais da
    // intranet não devem ir ao navegador (só o servidor precisa deles).
    fila: fila.map((l) => ({ ...l, codigos: [], vermelhos: [], historico: [] })),
    pontos: lista.map(paraDTO),
    // O registro da operação traz números e nomes de todos os motoristas:
    // fica só no servidor e não vai para os aparelhos.
    eventos: [],
    totalLeituras: contagens[0]?.leituras ?? 0,
    site: linksDoSite(),
    tabelas: fila.filter((l) => l.codigos.length > 0).length,
  };
}

export async function getEstado(motoristaId: number | null, forcar = false): Promise<EstadoDTO> {
  if (forcar) await varrer();
  return montarEstado(motoristaId);
}

/** Sem ponto cadastrado não há varredura: o monitor fica em repouso. */
export async function temPontoCadastrado() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pontos);
  return (count ?? 0) > 0;
}

let tabelasGarantidas = false;

export async function garantirTabelas() {
  if (tabelasGarantidas) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pontos (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL,
        livro TEXT NOT NULL,
        numero INTEGER NOT NULL,
        na_frente INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'AGUARDANDO',
        origem TEXT NOT NULL DEFAULT 'manual',
        visto_em TIMESTAMP WITH TIME ZONE,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        chamado_em TIMESTAMP WITH TIME ZONE,
        saida_em TIMESTAMP WITH TIME ZONE,
        ordem INTEGER NOT NULL DEFAULT 0,
        motorista_id INTEGER,
        alerta_perto INTEGER,
        CONSTRAINT ponto_unico_motorista UNIQUE (motorista_id, tipo, livro, numero)
      );
      CREATE TABLE IF NOT EXISTS motoristas (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        ponto_tipo TEXT,
        ponto_livro TEXT,
        ponto_numero INTEGER,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS motorista_sessoes (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS motorista_sessoes_motorista_id_idx ON motorista_sessoes (motorista_id);
      CREATE TABLE IF NOT EXISTS amostras (
        id SERIAL PRIMARY KEY,
        origem TEXT NOT NULL,
        dados JSONB NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        codigo TEXT NOT NULL,
        tipo TEXT NOT NULL,
        livro TEXT NOT NULL,
        numero INTEGER NOT NULL,
        acao TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        dispositivo TEXT NOT NULL DEFAULT '',
        ativa INTEGER NOT NULL DEFAULT 1,
        motorista_id INTEGER,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ultimo_envio_em TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS configuracao (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS notificacoes (
        id SERIAL PRIMARY KEY,
        tag TEXT NOT NULL UNIQUE,
        titulo TEXT NOT NULL,
        corpo TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        usuario TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ultimo_acesso_em TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS admin_sessoes (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS segredos (
        chave TEXT PRIMARY KEY,
        cifrado TEXT NOT NULL,
        final4 TEXT NOT NULL,
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        atualizado_por INTEGER
      );
      CREATE TABLE IF NOT EXISTS integracoes_status (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        verificado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS auditoria (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER,
        admin_nome TEXT NOT NULL,
        integracao TEXT NOT NULL,
        acao TEXT NOT NULL,
        detalhe TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_mensagens (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        texto TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS testes_push (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL,
        pedido_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        enviar_apos TIMESTAMP WITH TIME ZONE NOT NULL,
        processado_em TIMESTAMP WITH TIME ZONE,
        resultado TEXT
      );
      CREATE INDEX IF NOT EXISTS testes_push_endpoint_idx ON testes_push (endpoint);
      CREATE TABLE IF NOT EXISTS ia_mensagens (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        papel TEXT NOT NULL,
        texto TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ia_mensagens_motorista_idx ON ia_mensagens (motorista_id, id);
      CREATE TABLE IF NOT EXISTS monitor_codes (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
        codigo TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT monitor_codes_dono_codigo_unico UNIQUE (motorista_id, codigo)
      );
      CREATE INDEX IF NOT EXISTS monitor_codes_codigo_ativo_idx ON monitor_codes (codigo, ativo);
      CREATE TABLE IF NOT EXISTS monitor_pair_codes (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL,
        motorista_id INTEGER REFERENCES motoristas(id) ON DELETE CASCADE,
        codigo_hash TEXT NOT NULL UNIQUE,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        usado_em TIMESTAMP WITH TIME ZONE,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS monitor_pair_codes_expira_em_idx ON monitor_pair_codes (expira_em);
      CREATE TABLE IF NOT EXISTS monitor_devices (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL,
        motorista_id INTEGER REFERENCES motoristas(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        fcm_token TEXT,
        nome TEXT NOT NULL DEFAULT '',
        ativo INTEGER NOT NULL DEFAULT 1,
        ultimo_contato_em TIMESTAMP WITH TIME ZONE,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS monitor_devices_tipo_ativo_idx ON monitor_devices (tipo, ativo);
      CREATE INDEX IF NOT EXISTS monitor_devices_motorista_idx ON monitor_devices (motorista_id);
      CREATE TABLE IF NOT EXISTS monitor_messages (
        id SERIAL PRIMARY KEY,
        monitor_device_id INTEGER NOT NULL REFERENCES monitor_devices(id),
        event_id TEXT NOT NULL,
        origem TEXT NOT NULL,
        codigos JSONB NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT monitor_messages_device_event_unique UNIQUE (monitor_device_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS monitor_messages_criado_em_idx ON monitor_messages (criado_em);
      CREATE TABLE IF NOT EXISTS monitor_deliveries (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES monitor_messages(id),
        motorista_id INTEGER NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES monitor_devices(id),
        codigo TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT monitor_deliveries_unique UNIQUE (message_id, device_id, codigo)
      );
      CREATE INDEX IF NOT EXISTS monitor_deliveries_motorista_data_idx ON monitor_deliveries (motorista_id, criado_em);
      ALTER TABLE monitor_codes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE monitor_pair_codes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE monitor_devices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE monitor_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE monitor_deliveries ENABLE ROW LEVEL SECURITY;
    `);
    tabelasGarantidas = true;
  } catch (e) {
    // Se já existem, segue em frente
    tabelasGarantidas = true;
  }
  // Alerta individual do administrador (tabela nova, separada das demais).
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS alertas_motorista (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
        mensagem TEXT NOT NULL,
        admin_nome TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        resolvido_em TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX IF NOT EXISTS alertas_motorista_motorista_idx ON alertas_motorista(motorista_id);
      ALTER TABLE alertas_motorista ENABLE ROW LEVEL SECURITY;
    `);
  } catch {
    // já existe ou sem permissão: segue
  }
  // Silenciar só o chat (tabela nova, separada para não afetar as demais).
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_silenciados (
        motorista_id INTEGER PRIMARY KEY REFERENCES motoristas(id) ON DELETE CASCADE,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      ALTER TABLE chat_silenciados ENABLE ROW LEVEL SECURITY;
    `);
  } catch {
    // já existe ou sem permissão: segue
  }
  // Cada motorista monitora os próprios pontos: o mesmo número pode estar em
  // dois motoristas. Troca a regra antiga (um número só no app inteiro).
  // Separado do bloco acima para uma falha aqui não impedir criar as tabelas.
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ponto_unico' AND conrelid = 'pontos'::regclass) THEN
          ALTER TABLE pontos DROP CONSTRAINT ponto_unico;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ponto_unico_motorista' AND conrelid = 'pontos'::regclass) THEN
          ALTER TABLE pontos ADD CONSTRAINT ponto_unico_motorista UNIQUE (motorista_id, tipo, livro, numero);
        END IF;
      END $$;
    `);
  } catch {
    // já migrado por outro processo ou sem permissão: segue
  }
}

export async function garantirSemente() {
  await garantirTabelas();
  // Semeia uma única vez por banco: se já existe qualquer registro na
  // operação, o mestre já mexeu aqui e nada volta sozinho.
  const [{ registros }] = await db
    .select({ registros: sql<number>`count(*)::int` })
    .from(eventos);
  if ((registros ?? 0) > 0) return;

  await db
    .insert(pontos)
    .values([
      {
        tipo: "CAVALO",
        livro: "A",
        numero: 32,
        naFrente: 0,
        status: "SAIU",
        vistoEm: new Date(Date.now() - 1000 * 60 * 21),
        chamadoEm: new Date(Date.now() - 1000 * 60 * 26),
        saidaEm: new Date(Date.now() - 1000 * 60 * 21),
        ordem: 0,
      },
      {
        tipo: "CAVALO",
        livro: "A",
        numero: 80,
        naFrente: 13,
        status: "AGUARDANDO",
        vistoEm: new Date(),
        ordem: 1,
      },
    ])
    .onConflictDoNothing();

  await registrarEvento({
    codigo: "A32",
    tipo: "CAVALO",
    livro: "A",
    numero: 32,
    acao: "cadastrou",
    mensagem: "A32 entrou no monitoramento · varredura iniciada",
  });
  await registrarEvento({
    codigo: "A80",
    tipo: "CAVALO",
    livro: "A",
    numero: 80,
    acao: "cadastrou",
    mensagem: "A80 entrou no monitoramento · varredura iniciada",
  });
}
