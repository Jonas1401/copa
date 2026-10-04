import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

/**
 * Badge da notificação (ícone pequeno da barra de status, ao lado do relógio).
 *
 * O Android/Chrome só desenha o badge quando o PNG é monocromático: BRANCO
 * sobre TRANSPARENTE, 72x72. Se o arquivo tiver qualquer outra cor (por ex.
 * um desenho preto), o sistema não consegue aplicar a máscara e mostra um
 * quadradinho cinza no lugar do caminhão.
 *
 * Este teste trava essa regra para o problema não voltar. O caminho do
 * arquivo NÃO é escrito à mão aqui: ele é lido do `public/sw.js`, que é quem
 * baixa o badge — assim o teste nunca aprova um arquivo que o Service Worker
 * não usa (era exatamente o furo das tentativas anteriores, que apontavam
 * para arquivos que não existiam no repositório).
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/badge.test.ts
 */

/** Caminho que o Service Worker usa, no disco: /icons/x.png?v=1 -> public/icons/x.png */
function caminhoDoBadge(): { url: string; arquivo: string } {
  const sw = readFileSync("public/sw.js", "utf8");
  const achado = sw.match(/const BADGE\s*=\s*"([^"]+)"/);
  assert.ok(achado, "public/sw.js precisa declarar const BADGE = \"...\"");
  const url = achado[1];
  const semVersao = url.split("?")[0];
  assert.ok(
    semVersao.startsWith("/icons/") && !semVersao.startsWith("/icons/public/"),
    `o badge precisa ser servido de /icons/... (veio "${semVersao}"): o Next serve a pasta public na raiz, então /icons/public/... é 404 e a barra de status fica sem ícone`,
  );
  return { url, arquivo: `public${semVersao}` };
}

test("o Service Worker aponta para um arquivo que existe, com cache-bust", () => {
  const { url, arquivo } = caminhoDoBadge();
  assert.ok(existsSync(arquivo), `${arquivo} não existe: o Service Worker baixaria um badge 404`);
  assert.match(url, /\?v=\d+/, "sem ?v= o celular pode continuar usando o arquivo antigo em cache");
});

test("badge da notificação é branco sobre transparente, em 72x72", async () => {
  const { arquivo } = caminhoDoBadge();
  const { data, info } = await sharp(arquivo)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 72, "o badge precisa ter 72 px de largura");
  assert.equal(info.height, 72, "o badge precisa ter 72 px de altura");
  assert.ok(info.channels >= 4, "o badge precisa ter canal alpha");

  let opacos = 0;
  let coloridos = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a <= 200) continue;
    opacos += 1;
    // Monocromático: todo pixel visível tem de ser branco puro.
    if (r !== 255 || g !== 255 || b !== 255) coloridos += 1;
  }

  assert.equal(
    coloridos,
    0,
    "o badge tem pixels visíveis coloridos: o Android desenha um quadrado cinza no lugar dele",
  );
  // Silhueta de fato desenhada (não é uma imagem vazia).
  assert.ok(opacos > 300, `o badge quase não tem desenho (${opacos} pixels)`);
  // E espaço sobrando em volta, para o Android não cortar o desenho.
  assert.ok(opacos < 72 * 72 * 0.6, "o badge está cheio demais: falta respiro");

  const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  for (const [x, y] of [
    [0, 0],
    [71, 0],
    [0, 71],
    [71, 71],
  ]) {
    assert.equal(alpha(x, y), 0, `o canto ${x},${y} deveria ser transparente`);
  }
});

test("o Service Worker mostra o badge no aviso", () => {
  const sw = readFileSync("public/sw.js", "utf8");
  assert.match(sw, /badge:\s*dados\.badge \|\| BADGE/);
});

/* ------------------------------------------------ gerador (scripts/gerar-badge.mjs) */

function rodarGerador(fonte: string, saida: string): string {
  return execFileSync("node", ["scripts/gerar-badge.mjs", `--fonte=${fonte}`, `--saida=${saida}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Roda o gerador esperando recusa e devolve a mensagem de erro. */
function recusa(fonte: string, saida: string): string {
  try {
    rodarGerador(fonte, saida);
  } catch (erro) {
    const e = erro as Error & { stderr?: Buffer | string };
    return String(e.stderr || e.message);
  }
  assert.fail("o gerador aceitou uma arte que não serve como badge");
}

test("o gerador recusa arte com fundo opaco e arte escura em vez de adivinhar o recorte", async () => {
  const pasta = mkdtempSync(path.join(tmpdir(), "badge-gerador-"));

  // 1) Arte com fundo opaco: era o arquivo que o Service Worker apontava e que
  //    o Android desenhava como quadradinho cinza.
  const opaca = path.join(pasta, "opaca.png");
  await sharp({ create: { width: 72, height: 72, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toFile(opaca);
  assert.match(recusa(opaca, pasta), /FUNDO OPACO/);

  // 2) Desenho escuro sobre transparente (arte enviada pelo celular): o recorte
  //    existe, mas vem do desenho ser preto — viraria mancha.
  const escura = path.join(pasta, "escura.png");
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72">` +
        `<rect x="10" y="24" width="52" height="24" fill="#333333"/></svg>`,
    ),
  )
    .png()
    .toFile(escura);
  assert.match(recusa(escura, pasta), /escuros|desenho escuro/);
});

test("o gerador produz o mesmo badge do repositório a partir do vetor (e não muda sozinho)", async () => {
  const pasta = mkdtempSync(path.join(tmpdir(), "badge-vetor-"));
  const destino = path.join(pasta, "icons", "copalinks-badge-72.png");

  rodarGerador("public/icons/badge.svg", pasta);
  assert.ok(existsSync(destino), "o gerador precisa gravar o badge no caminho que o app usa");
  const gerado = readFileSync(destino);
  assert.deepEqual(
    gerado,
    readFileSync("public/icons/copalinks-badge-72.png"),
    "o badge publicado ficou diferente do que o vetor gera: rode `node scripts/gerar-badge.mjs`",
  );

  // Rodar de novo não altera o arquivo (a mensagem de ?v= não aparece à toa).
  const aviso = rodarGerador("public/icons/badge.svg", pasta);
  assert.deepEqual(readFileSync(destino), gerado);
  assert.doesNotMatch(aviso, /MUDOU/, "o gerador avisou de mudança num arquivo idêntico");
});
