/**
 * Segmentação da folha de figurinhas — lógica pura, sem I/O.
 *
 * Recebe os bytes RGBA da folha e as caixas de referência de cada figurinha e
 * devolve, para cada pixel, o índice da figurinha dona dele (-1 = fundo/ruído).
 *
 * Etapas:
 *   1. Fundo: flood fill do preto/preto-azulado a partir da borda da folha.
 *      O preto que faz parte do desenho (contornos, óculos) é preservado.
 *   2. Componentes conexos da folha inteira. Cada componente vai para a
 *      figurinha que contém a maior parte dele — o desenho é entregue inteiro
 *      mesmo quando ultrapassa a caixa de referência.
 *   3. Detalhes soltos (vapor, riscos de movimento) vão para a caixa mais perto.
 *   4. Blob compartilhado por duas figurinhas que se encostam: dividido por
 *      distância geodésica (BFS simultâneo a partir das sementes de cada lado)
 *      e alisado com um filtro de maioria na divisa.
 *   5. Sobreposições declaradas no manifesto: retoque fino, pixel a pixel.
 *
 * Nenhum pixel de desenho é apagado: a soma dos pixels atribuídos é igual ao
 * total de pixels de desenho da folha (menos o ruído abaixo do mínimo).
 */

export const PADRAO = {
  limiarFundo: 28,
  alphaMinimo: 16,
  componenteMinimo: 12,
  distanciaSatelite: 28,
  margemSemente: 8,
  raioDivisa: 3,
  passosDivisa: 4,
};

const dentroDaCaixa = (caixa, x, y) => x >= caixa[0] && x < caixa[2] && y >= caixa[1] && y < caixa[3];

const distanciaCaixa = (caixa, x, y) => {
  const dx = Math.max(caixa[0] - x, 0, x - (caixa[2] - 1));
  const dy = Math.max(caixa[1] - y, 0, y - (caixa[3] - 1));
  return Math.hypot(dx, dy);
};

export function segmentarFolha({ dados, largura: W, altura: H, figurinhas, opcoes = {} }) {
  const cfg = { ...PADRAO, ...opcoes };
  const N = W * H;
  const pilha = new Int32Array(N);
  let topo = 0;

  /* ---------------------------------------------------------- 1. o fundo */
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) alpha[i] = dados[i * 4 + 3];

  const candidato = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) {
    const o = i * 4;
    if (alpha[i] < 128 || Math.max(dados[o], dados[o + 1], dados[o + 2]) <= cfg.limiarFundo) {
      candidato[i] = 1;
    }
  }
  const fundo = new Uint8Array(N);
  const empilharFundo = (i) => {
    if (candidato[i] && !fundo[i]) { fundo[i] = 1; pilha[topo++] = i; }
  };
  for (let x = 0; x < W; x += 1) { empilharFundo(x); empilharFundo((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { empilharFundo(y * W); empilharFundo(y * W + W - 1); }
  while (topo > 0) {
    const i = pilha[--topo];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) empilharFundo(i - 1);
    if (x + 1 < W) empilharFundo(i + 1);
    if (y > 0) empilharFundo(i - W);
    if (y + 1 < H) empilharFundo(i + W);
  }
  for (let i = 0; i < N; i += 1) if (fundo[i]) alpha[i] = 0;

  /* ------------------------------------------- 2. componentes conexos */
  const rotulo = new Int32Array(N);
  const componentes = [];
  for (let inicio = 0; inicio < N; inicio += 1) {
    if (rotulo[inicio] || alpha[inicio] <= cfg.alphaMinimo) continue;
    const id = componentes.length + 1;
    let tamanho = 0, somaX = 0, somaY = 0;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    topo = 0;
    pilha[topo++] = inicio;
    rotulo[inicio] = id;
    while (topo > 0) {
      const p = pilha[--topo];
      const x = p % W, y = (p / W) | 0;
      tamanho += 1; somaX += x; somaY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !rotulo[p - 1] && alpha[p - 1] > cfg.alphaMinimo) { rotulo[p - 1] = id; pilha[topo++] = p - 1; }
      if (x + 1 < W && !rotulo[p + 1] && alpha[p + 1] > cfg.alphaMinimo) { rotulo[p + 1] = id; pilha[topo++] = p + 1; }
      if (y > 0 && !rotulo[p - W] && alpha[p - W] > cfg.alphaMinimo) { rotulo[p - W] = id; pilha[topo++] = p - W; }
      if (y + 1 < H && !rotulo[p + W] && alpha[p + W] > cfg.alphaMinimo) { rotulo[p + W] = id; pilha[topo++] = p + W; }
    }
    componentes.push({ id, tamanho, cx: somaX / tamanho, cy: somaY / tamanho, minX, minY, maxX, maxY });
  }

  /* ------------------------------------------- 3. dono de cada componente */
  const dono = new Int32Array(N).fill(-1);
  const contestados = [];
  for (const c of componentes) {
    if (c.tamanho < cfg.componenteMinimo) continue;
    const contagem = new Map();
    for (let y = c.minY; y <= c.maxY; y += 1) {
      for (let x = c.minX; x <= c.maxX; x += 1) {
        if (rotulo[y * W + x] !== c.id) continue;
        for (let f = 0; f < figurinhas.length; f += 1) {
          if (dentroDaCaixa(figurinhas[f].caixa, x, y)) {
            contagem.set(f, (contagem.get(f) ?? 0) + 1);
            break;
          }
        }
      }
    }
    const ranking = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const relevantes = ranking.filter(([, n]) => n >= c.tamanho * 0.1);
    if (relevantes.length >= 2) {
      contestados.push({ componente: c, candidatas: relevantes.map(([f]) => f) });
      continue;
    }
    let escolhido;
    if (ranking.length) {
      escolhido = ranking[0][0];
    } else {
      let melhor = cfg.distanciaSatelite;
      for (let f = 0; f < figurinhas.length; f += 1) {
        const d = distanciaCaixa(figurinhas[f].caixa, c.cx, c.cy);
        if (d < melhor) { melhor = d; escolhido = f; }
      }
      if (escolhido === undefined) continue;
    }
    for (let y = c.minY; y <= c.maxY; y += 1) {
      for (let x = c.minX; x <= c.maxX; x += 1) {
        const i = y * W + x;
        if (rotulo[i] === c.id) dono[i] = escolhido;
      }
    }
  }

  /* ------------------------------- 4. divide os blobs compartilhados */
  const separadas = [];
  for (const { componente: c, candidatas } of contestados) {
    const fila = new Int32Array(c.tamanho);
    let cabeca = 0, cauda = 0;
    for (const f of candidatas) {
      const caixa = figurinhas[f].caixa;
      const outras = candidatas.filter((g) => g !== f).map((g) => figurinhas[g].caixa);
      let sementes = 0;
      for (let y = c.minY; y <= c.maxY; y += 1) {
        for (let x = c.minX; x <= c.maxX; x += 1) {
          const i = y * W + x;
          if (rotulo[i] !== c.id || dono[i] !== -1) continue;
          if (!dentroDaCaixa(caixa, x, y)) continue;
          if (outras.some((o) => distanciaCaixa(o, x, y) < cfg.margemSemente)) continue;
          dono[i] = f; fila[cauda++] = i; sementes += 1;
        }
      }
      if (sementes === 0) {
        const [x0, y0, x1, y1] = caixa;
        const mx = (x1 - x0) * 0.25, my = (y1 - y0) * 0.25;
        for (let y = Math.max(c.minY, Math.floor(y0 + my)); y <= Math.min(c.maxY, Math.ceil(y1 - my)); y += 1) {
          for (let x = Math.max(c.minX, Math.floor(x0 + mx)); x <= Math.min(c.maxX, Math.ceil(x1 - mx)); x += 1) {
            const i = y * W + x;
            if (rotulo[i] === c.id && dono[i] === -1) { dono[i] = f; fila[cauda++] = i; }
          }
        }
      }
    }
    if (cauda === 0) {
      throw new Error(`Blob compartilhado sem semente: ${candidatas.map((f) => figurinhas[f].slug).join(" + ")}`);
    }
    while (cabeca < cauda) {
      const p = fila[cabeca++];
      const x = p % W, y = (p / W) | 0;
      const vizinhos = [];
      if (x > 0) vizinhos.push(p - 1);
      if (x + 1 < W) vizinhos.push(p + 1);
      if (y > 0) vizinhos.push(p - W);
      if (y + 1 < H) vizinhos.push(p + W);
      for (const v of vizinhos) {
        if (rotulo[v] === c.id && dono[v] === -1) { dono[v] = dono[p]; fila[cauda++] = v; }
      }
    }

    // Alisamento da divisa: devolve fiapos finos ao dono certo.
    const r = cfg.raioDivisa;
    for (let passo = 0; passo < cfg.passosDivisa; passo += 1) {
      const trocas = [];
      for (let y = c.minY; y <= c.maxY; y += 1) {
        for (let x = c.minX; x <= c.maxX; x += 1) {
          const i = y * W + x;
          if (rotulo[i] !== c.id) continue;
          const atual = dono[i];
          let meus = 0, outros = 0, vizinho = -1;
          for (let dy = -r; dy <= r; dy += 1) {
            const yy = y + dy;
            if (yy < c.minY || yy > c.maxY) continue;
            for (let dx = -r; dx <= r; dx += 1) {
              const xx = x + dx;
              if (xx < c.minX || xx > c.maxX) continue;
              const j = yy * W + xx;
              if (rotulo[j] !== c.id) continue;
              if (dono[j] === atual) meus += 1;
              else { outros += 1; vizinho = dono[j]; }
            }
          }
          if (vizinho >= 0 && outros > meus * 1.5) trocas.push(i, vizinho);
        }
      }
      if (!trocas.length) break;
      for (let t = 0; t < trocas.length; t += 2) dono[trocas[t]] = trocas[t + 1];
    }
    separadas.push(candidatas.map((f) => figurinhas[f].slug));
  }

  /* ------------------------------- 5. sobreposições declaradas */
  const sobreposicoes = [];
  for (const [indice, item] of figurinhas.entries()) {
    for (const [x0, y0, x1, y1] of item.sobreposicao ?? []) {
      let movidos = 0;
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
          const i = y * W + x;
          if (alpha[i] > cfg.alphaMinimo && dono[i] !== indice) { dono[i] = indice; movidos += 1; }
        }
      }
      if (movidos) sobreposicoes.push({ slug: item.slug, movidos });
    }
  }

  return { dono, alpha, separadas, sobreposicoes };
}

/** Conta os pixels de desenho (acima do limiar) de cada figurinha. */
export function contarPixels(dono, alpha, total, alphaMinimo = PADRAO.alphaMinimo) {
  const contagem = new Array(total).fill(0);
  let desenho = 0;
  for (let i = 0; i < dono.length; i += 1) {
    if (alpha[i] <= alphaMinimo) continue;
    desenho += 1;
    if (dono[i] >= 0) contagem[dono[i]] += 1;
  }
  return { contagem, desenho };
}
