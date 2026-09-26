import { desc, eq, sql } from "drizzle-orm";
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
  /** Tabela do site, na ordem exibida, já sem as linhas vermelhas. */
  codigos: number[];
  /** Os números das linhas em vermelho (fora da contagem). */
  vermelhos: number[];
  /** Linhas em vermelho: ignoradas na contagem. */
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
  geradoEm: string;
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
  atualizadoEm: string;
  origem: string;
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
    return direto;
  }
  const viaComposio = await lerPeloComposio();
  if (viaComposio) fonteUltimaLeitura = "composio";
  return viaComposio;
}

/**
 * Leitura de reserva: o Composio devolve cada quadro em markdown, com os
 * blocos na ordem do site (1º TRUCK, 2º CARRETA) e sem as cores das linhas.
 */
export function parseMarkdownQuadros(textos: string[]): FilaEstado | null {
  const fila = baseFila();
  let achou = false;
  textos.forEach((texto, i) => {
    const livro = LIVROS[i];
    if (!texto) return;
    const blocos = texto.split(/#+\s*Último\s+Escalado:/i).slice(1);
    blocos.slice(0, 2).forEach((bloco, j) => {
      const tipo: Tipo = j === 0 ? "TRUCK" : "CAVALO";
      const ult = bloco.match(/^\s*\**\s*([ABM])?\s*(\d{1,3})/i);
      const codigos = [...bloco.matchAll(/\|\s*\d+\s*\|\s*([ABM])\s*(\d{1,3})\s*\|/gi)].map((m) => Number(m[2]));
      const k = chave(tipo, livro);
      fila[k] = {
        tipo,
        livro,
        naFila: codigos.length,
        ultimo: ult ? Number(ult[2]) : 0,
        codigos,
        vermelhos: [],
        ignorados: 0,
        historico: historicoDe(fila[k], ult ? Number(ult[2]) : 0),
      };
      achou = true;
    });
  });
  return achou ? fila : null;
}

export function parseQuadros(corpos: string[]): FilaEstado | null {
  const fila = baseFila();
  let achou = false;

  corpos.forEach((corpo, i) => {
    const livro = LIVROS[i];
    if (!corpo) return;

    for (const bloco of corpo.split(/<h2[^>]*>/i).slice(1)) {
      const cabecalho = bloco.match(/^\s*Livro\s*([ABM])\s*-\s*(TRUCK|CARRETA)/i);
      if (!cabecalho) continue;

      const tipo: Tipo =
        cabecalho[2].toUpperCase() === "TRUCK" ? "TRUCK" : "CAVALO";
      const ultimoM = bloco.match(
        /Último\s*Escalado:\s*<b>\s*([ABM])?\s*(\d{1,3})/i,
      );
      const ultimo = ultimoM ? Number(ultimoM[2]) : 0;

      // A tabela do site, linha por linha. A contagem começa em 1 e as linhas
      // em vermelho (bgcolor #ff0000) ficam de fora: são ignoradas.
      const codigos: number[] = [];
      const vermelhos: number[] = [];
      for (const linha of bloco.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
        const html = linha[0];
        if (!/<td/i.test(html)) continue;
        const cod = html.match(/<h3>\s*([ABM])\s*(\d{1,3})/i);
        if (!cod) continue;
        const vermelho = /bgcolor\s*=\s*['"]?(#f{1,2}0{1,2}0{1,2}|red)/i.test(
          html,
        );
        if (vermelho) {
          vermelhos.push(Number(cod[2]));
          continue;
        }
        codigos.push(Number(cod[2]));
      }

      const k = chave(tipo, livro);
      fila[k] = {
        tipo,
        livro,
        naFila: codigos.length,
        ultimo,
        codigos,
        vermelhos,
        ignorados: vermelhos.length,
        historico: historicoDe(fila[k], ultimo),
      };
      achou = true;
    }
  });

  return achou ? fila : null;
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
 * Varre o site inteiro (6 tabelas) e confere, ponto a ponto, se ele ainda
 * está dentro de alguma tabela. Saiu da tabela = SAIU.
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
    // Na reserva não há cor: as linhas que estavam vermelhas na última leitura
    // direta continuam fora da contagem enquanto aparecerem na tabela.
    if (fonte === "composio" && anterior) {
      for (const k of Object.keys(fila)) {
        const verm = new Set(anterior[k]?.vermelhos ?? []);
        if (!verm.size) continue;
        fila[k].vermelhos = fila[k].codigos.filter((n) => verm.has(n));
        fila[k].codigos = fila[k].codigos.filter((n) => !verm.has(n));
        fila[k].ignorados = fila[k].vermelhos.length;
        fila[k].naFila = fila[k].codigos.length;
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

  const snapshot: Snapshot = {
    origem: lido ? fonte : "offline",
    fila,
    geradoEm: new Date().toISOString(),
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
      const dispararPush = (
        acao: "chamada" | "saiu" | "voltou" | "perto",
        codigoNaVez: string,
      ) => {
        void notificarEvento({
          acao,
          tipo,
          livro: p.livro as Livro,
          codigo,
          codigoNaVez,
          rotulo: ROTULO_TIPO[tipo],
          motoristaId: p.motoristaId ?? null,
          naFrente: naFrenteAviso,
        }).catch(() => {});
      };

      // Procura o número na tabela do seu tipo e livro.
      let posicao = posicaoNaFila(fila, tipo, p.livro as Livro, p.numero);
      if (posicao < 0 && estaVermelho(fila, tipo, p.livro as Livro, p.numero)) {
        // Está na tabela, mas numa linha vermelha: fora da contagem e na vez.
        posicao = 0;
      }
      if (posicao < 0) {
        // Não bateu? O mestre pode ter errado o tipo: confere a outra tabela
        // do mesmo livro antes de declarar que o ponto saiu.
        const outro: Tipo = tipo === "TRUCK" ? "CAVALO" : "TRUCK";
        const emOutro = posicaoNaFila(fila, outro, p.livro as Livro, p.numero);
        const vermelhoOutro =
          emOutro < 0 && estaVermelho(fila, outro, p.livro as Livro, p.numero);
        if (emOutro >= 0 || vermelhoOutro) {
          posicao = vermelhoOutro ? 0 : emOutro;
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
        // Não está dentro de nenhuma tabela: saiu.
        if (p.status !== "SAIU") {
          await db
            .update(pontos)
            .set({
              status: "SAIU",
              naFrente: 0,
              saidaEm: new Date(),
              chamadoEm: p.chamadoEm ?? new Date(),
            })
            .where(eq(pontos.id, p.id));
          await registrarEvento({
            codigo,
            tipo: p.tipo,
            livro: p.livro,
            numero: p.numero,
            acao: "saiu",
            mensagem: `${codigo} não está mais nas tabelas · saiu`,
          });
          dispararPush("saiu", naVezAgora());
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
          dispararPush("voltou", naVezAgora());
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
        dispararPush("perto", naVezAgora());
      } else if (posicao === 0 && p.status !== "NA VEZ") {
        await registrarEvento({
          codigo,
          tipo,
          livro: p.livro,
          numero: p.numero,
            acao: "chamou",
            mensagem: `${codigo} é o número 1 da fila · na vez`,
          });
          dispararPush("chamada", naVezAgora());
      }
    }),
  );
}

function posicaoNaFila(
  fila: FilaEstado,
  tipo: Tipo,
  livro: Livro,
  numero: number,
) {
  const linha = fila[chave(tipo, livro)];
  return linha ? linha.codigos.indexOf(numero) : -1;
}

/** Número que aparece numa linha vermelha: fora da contagem da fila. */
function estaVermelho(
  fila: FilaEstado,
  tipo: Tipo,
  livro: Livro,
  numero: number,
) {
  const linha = fila[chave(tipo, livro)];
  return linha ? linha.vermelhos.includes(numero) : false;
}

// ------------------------------------------------------------- montagem
function paraDTO(p: typeof pontos.$inferSelect): PontoDTO {
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
export async function montarEstado(): Promise<EstadoDTO> {
  const [ultimaAmostra, lista, evs, contagens] = await Promise.all([
    db.select().from(amostras).orderBy(desc(amostras.id)).limit(1),
    db.select().from(pontos).orderBy(pontos.ordem, pontos.id),
    db.select().from(eventos).orderBy(desc(eventos.id)).limit(40),
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

  return {
    atualizadoEm: snapshot.geradoEm,
    origem: snapshot.origem,
    online: snapshot.origem !== "offline",
    fila,
    pontos: lista.map(paraDTO),
    eventos: evs.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      acao: e.acao,
      mensagem: e.mensagem,
      criadoEm: e.criadoEm.toISOString(),
    })),
    totalLeituras: contagens[0]?.leituras ?? 0,
    site: linksDoSite(),
    tabelas: fila.filter((l) => l.codigos.length > 0).length,
  };
}

export async function getEstado(forcar = false): Promise<EstadoDTO> {
  if (forcar) await varrer();
  return montarEstado();
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
        CONSTRAINT ponto_unico UNIQUE (tipo, livro, numero)
      );
      CREATE TABLE IF NOT EXISTS motoristas (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        ponto_tipo TEXT,
        ponto_livro TEXT,
        ponto_numero INTEGER,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
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
    `);
    tabelasGarantidas = true;
  } catch (e) {
    // Se já existem, segue em frente
    tabelasGarantidas = true;
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
