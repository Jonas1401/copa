import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  CATEGORIAS_PADRAO,
  chaveCategoria,
  formatoFigurinha,
  MIME_FIGURINHA,
  nomeCategoria,
  nomeFigurinha,
  ordemFigurinha,
  pushFigurinhaEnviada,
  TAMANHO_MAX_FIGURINHA,
  textoFigurinhaEnviada,
} from "../src/lib/figurinhas-catalogo";
import { PACOTE_FIGURINHAS } from "../src/lib/figurinhas-pacote";

/* --------------------------------------------- regras puras do catálogo */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);

test("upload aceita só PNG, WebP e GIF — conferido pelos bytes reais", () => {
  assert.deepEqual(formatoFigurinha(PNG), { mime: "image/png", extensao: "png" });
  assert.deepEqual(formatoFigurinha(GIF), { mime: "image/gif", extensao: "gif" });
  assert.deepEqual(formatoFigurinha(WEBP), { mime: "image/webp", extensao: "webp" });
  // JPEG, SVG, HTML e "executável" disfarçado não passam.
  assert.equal(formatoFigurinha(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), null);
  assert.equal(formatoFigurinha(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e])), null);
  assert.equal(formatoFigurinha(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), null);
  assert.equal(formatoFigurinha(new Uint8Array([])), null);
  // MIME informado que contradiz o arquivo também é rejeitado.
  assert.equal(formatoFigurinha(PNG, "image/gif"), null);
  assert.deepEqual(formatoFigurinha(PNG, "image/png"), { mime: "image/png", extensao: "png" });
});

test("limite de 512 KB e nomes/categorias seguros", () => {
  assert.equal(TAMANHO_MAX_FIGURINHA, 512 * 1024);
  const gigante = new Uint8Array(TAMANHO_MAX_FIGURINHA + 1);
  gigante.set(PNG.subarray(0, 8));
  assert.equal(formatoFigurinha(gigante), null, "arquivo acima do limite não pode passar");

  assert.equal(nomeFigurinha("  Caminhão feliz  "), "Caminhão feliz");
  assert.equal(nomeFigurinha("a"), null, "nome curto demais");
  assert.equal(nomeFigurinha("x".repeat(80))?.length, 60, "nome longo é cortado em 60");
  assert.equal(nomeFigurinha("nome\ncom\nquebra"), "nome com quebra");

  assert.equal(chaveCategoria("Caminhões"), "caminhoes");
  assert.equal(chaveCategoria("Porto de Paranaguá!"), "porto-de-paranagua");
  assert.equal(chaveCategoria("??"), null);
  assert.equal(nomeCategoria(" Porto "), "Porto");
  assert.equal(nomeCategoria(" P "), null);

  assert.equal(ordemFigurinha(7), 7);
  assert.equal(ordemFigurinha("12"), 12);
  assert.equal(ordemFigurinha(-1), 0);
  assert.equal(ordemFigurinha("abc"), 0);
});

test("categorias oficiais: as 7 pedidas, em ordem e sem repetição", () => {
  assert.deepEqual(CATEGORIAS_PADRAO.map((c) => c.chave), [
    "caminhoes", "porto", "motoristas", "saudacoes", "reacoes", "cafe", "trabalho",
  ]);
  assert.deepEqual(CATEGORIAS_PADRAO.map((c) => c.nome), [
    "Caminhões", "Porto e navios", "Motoristas", "Saudações", "Reações",
    "Café e alimentação", "Trabalho e descanso",
  ]);
  assert.equal(new Set(CATEGORIAS_PADRAO.map((c) => c.chave)).size, 7);
  assert.ok(CATEGORIAS_PADRAO.every((c) => c.pacote === "copalinks"));
  assert.deepEqual(CATEGORIAS_PADRAO.map((c) => c.ordem), [0, 1, 2, 3, 4, 5, 6]);
  for (const c of CATEGORIAS_PADRAO) assert.ok(chaveCategoria(c.nome) || chaveCategoria(c.chave));
});

test("mensagem e push da figurinha têm formato próprio (não confunde com texto)", () => {
  assert.equal(textoFigurinhaEnviada("Caminhão feliz"), "🎨 Caminhão feliz");
  assert.equal(pushFigurinhaEnviada("Caminhão feliz"), '🖼️ Enviou a figurinha "Caminhão feliz"');
  assert.ok(textoFigurinhaEnviada("x".repeat(600)).length <= 500);
});

/* ------------------------------------ coleção recortada (arquivos + pacote) */

const PASTA = path.join(process.cwd(), "public", "stickers", "cop alinks");

test("coleção oficial: 42 PNGs transparentes, sem duplicatas e em 7 categorias", async () => {
  assert.equal(PACOTE_FIGURINHAS.length, 42, "a imagem oficial tem 42 figurinhas");
  const nomes = PACOTE_FIGURINHAS.map((f) => f.nome);
  const slugs = PACOTE_FIGURINHAS.map((f) => f.slug);
  assert.equal(new Set(nomes).size, 42, "nomes repetidos no pacote");
  assert.equal(new Set(slugs).size, 42, "slugs repetidos no pacote");
  for (const c of CATEGORIAS_PADRAO) {
    assert.ok(PACOTE_FIGURINHAS.some((f) => f.categoria === c.chave), `sem figurinhas em ${c.chave}`);
  }

  const arquivos = readdirSync(PASTA).filter((n) => n.endsWith(".png"));
  assert.equal(arquivos.length, 42, "a pasta pública precisa ter os 42 PNGs");
  assert.equal(new Set(arquivos).size, 42, "arquivo duplicado na pasta");

  for (const f of PACOTE_FIGURINHAS) {
    assert.ok(nomeFigurinha(f.nome), `nome inválido: ${f.nome}`);
    assert.ok(CATEGORIAS_PADRAO.some((c) => c.chave === f.categoria), `categoria desconhecida: ${f.categoria}`);
    assert.equal(f.mime, "image/png");
    assert.equal(f.arquivo, `${f.slug}.png`);
    const bytes = readFileSync(path.join(PASTA, f.arquivo));
    const embutido = Buffer.from(f.base64, "base64");
    assert.ok(bytes.equals(embutido), `${f.arquivo} diferente do base64 semeado no banco`);
    assert.ok(bytes.length > 0 && bytes.length <= TAMANHO_MAX_FIGURINHA, `${f.slug} fora do tamanho`);
    assert.deepEqual(formatoFigurinha(new Uint8Array(bytes)), { mime: "image/png", extensao: "png" }, f.slug);
    assert.equal(MIME_FIGURINHA[f.mime], "png");

    // Alpha real: canto 100% transparente e miolo com pixels opacos (não é
    // um retângulo opaco nem uma figurinha "vazia").
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
      assert.equal(alpha(x, y), 0, `${f.slug}: canto sem transparência`);
    }
    assert.ok(info.width >= 256 && info.height >= 128, `${f.slug}: resolução baixa`);
    assert.ok(info.width <= 512 && info.height <= 512, `${f.slug}: PNG grande demais`);
  }
});

test("catalogo.json acompanha os arquivos gerados", () => {
  const catalogo = JSON.parse(readFileSync(path.join(PASTA, "catalogo.json"), "utf8"));
  assert.equal(catalogo.total, 42);
  assert.deepEqual(catalogo.categorias, CATEGORIAS_PADRAO.map((c) => c.chave));
  assert.equal(new Set(catalogo.figurinhas.map((f: { arquivo: string }) => f.arquivo)).size, 42);
  assert.deepEqual(catalogo.figurinhas.map((f: { nome: string }) => f.nome), PACOTE_FIGURINHAS.map((f) => f.nome));
});

/* ---------------------------------------------- o chat continua inteiro */

const ler = (caminho: string) => readFileSync(caminho, "utf8");

test("seletor do chat: só emojis + coleção nova, 4 colunas e categorias", () => {
  const s = ler("src/components/chat/ChatMotoristas.tsx");
  // Abas de sempre preservadas; recados de texto saíram do seletor.
  assert.ok(s.includes('"emojis" ? "😀 Emojis" : "🚛 Figurinhas"'), "as abas Emojis/Figurinhas mudaram");
  assert.ok(s.includes("EMOJIS.map"), "o seletor de emojis sumiu");
  assert.ok(!s.includes("FIGURINHAS.map"), "os recados antigos ainda aparecem no seletor");
  assert.ok(!s.includes('chave: "recados"'), "a categoria Recados não foi removida");
  assert.ok(s.includes("figurinhaDe"), "mensagens antigas de recado pararam de renderizar");
  // Grade organizada, 4 colunas em telas que permitem, sem cortes.
  assert.ok(s.includes('aria-label="Categorias de figurinhas"'), "faltou o seletor de categorias");
  assert.ok(s.includes("iconeCategoria"), "as categorias não ganham ícone");
  assert.ok(s.includes("grid grid-cols-3 gap-2 sm:grid-cols-4"), "a grade responsiva de 4 colunas sumiu");
  assert.ok(s.includes("object-contain p-1.5"), "a figurinha pode ser cortada na célula");
  assert.ok(s.includes("rolagem-figurinhas"), "a rolagem suave não foi aplicada");
  assert.ok(s.includes("enviarFigurinha(figurinha.id)"), "toque na figurinha não envia");
  assert.ok(s.includes('fetch("/api/figurinhas", { cache: "no-store" })'), "o catálogo não atualiza ao abrir a aba");
  // Nada do chat existente foi removido.
  for (const recurso of [
    "function PlayerAudio",
    "AcaoAnexo",
    "<AssistenteIA aberto={iaAberta}",
    "alternarSilencio",
    "function ConteudoMensagem",
    "figurinhaDe",
  ]) {
    assert.ok(s.includes(recurso), `o chat perdeu: ${recurso}`);
  }
});

test("instalação no banco substitui o pacote antigo sem apagar mensagens", () => {
  const s = ler("src/lib/figurinhas-admin.ts");
  assert.ok(s.includes("figurinhas_colecao_copalinks_2026_v1"), "faltou a versão nova da semente");
  assert.ok(s.includes("copalinks-2026"), "as figurinhas novas não têm pacote próprio");
  assert.ok(s.includes("NOMES_PACOTE_ANTIGO"), "o pacote antigo não é desativado");
  assert.ok(s.includes("set({ ativa: false"), "o pacote antigo foi apagado em vez de desativado");
  assert.ok(s.includes("onConflictDoUpdate"), "as categorias existentes não são renomeadas");
  assert.ok(s.includes("pg_advisory_xact_lock"), "sem proteção contra semente duplicada");
  assert.ok(s.includes("PACOTE_FIGURINHAS"), "a coleção nova não é semeada");
  const api = ler("src/app/api/figurinhas/route.ts");
  assert.ok(api.includes("emUso.has(c.chave)"), "categorias vazias do pacote antigo aparecem no seletor");
});

test("figurinha enviada aparece SEM balão, com fundo transparente, autor e horário", () => {
  const s = ler("src/components/chat/ChatMotoristas.tsx");
  assert.ok(
    s.includes('const temFigurinha = tipo === "figurinha" && Boolean(mensagem.mediaUrl);'),
    "as mensagens de figurinha não são reconhecidas",
  );
  const bloco = s.slice(s.indexOf("temFigurinha ? ("), s.indexOf(") : sistema ? ("));
  assert.ok(bloco.includes("data-reacao-area"), "a figurinha perdeu as curtidas");
  assert.ok(!/rounded-\[20px\] border/.test(bloco), "a figurinha voltou a nascer dentro de bolha");
  assert.ok(bloco.includes("object-contain drop-shadow"), "a figurinha perdeu o desenho com fundo transparente");
  assert.ok(bloco.includes('meu ? "Você" : mensagem.nome'), "a figurinha perdeu o autor");
  assert.ok(bloco.includes("MetaMensagem"), "a figurinha perdeu o horário/rodapé");
  assert.ok(bloco.includes("flex-row-reverse"), "a figurinha do próprio não espelha o lado");
});

test("envio no chat: figurinhaId copia a imagem para a mensagem e valida o catálogo", () => {
  const s = ler("src/app/api/chat/route.ts");
  assert.ok(s.includes("figurinhaId"), "o POST do chat não aceita figurinhaId");
  assert.ok(s.includes('tipo = "figurinha"'), "a mensagem não é gravada como figurinha");
  assert.ok(s.includes("obterFigurinhaComImagem"), "o servidor não busca a figurinha no catálogo");
  assert.ok(s.includes("mediaDados = figurinha.dados"), "a imagem não é copiada para a mensagem");
  assert.ok(s.includes("pushFigurinhaEnviada"), "o push da figurinha não tem texto próprio");
  assert.ok(s.includes("Figurinha não encontrada ou desativada"), "figurinha desativada não é bloqueada");
  // O envio de texto/mídia de sempre continua.
  for (const recurso of ["podeEnviar", "TIPOS_MIDIA", "notificarMensagemChat", "TAMANHO_MAX", "duracaoSegundos"]) {
    assert.ok(s.includes(recurso), `o chat perdeu: ${recurso}`);
  }
});

test("painel admin publica, ativa/desativa, reordena, exclui e valida uploads", () => {
  const admin = ler("src/components/admin/CartaoFigurinhasAdmin.tsx");
  for (const recurso of [
    "Publicar figurinha",
    "Prévia da figurinha",
    "Desativar figurinha",
    "Excluir do catálogo",
    "Subir na ordem",
    "Criar",
    "FORMATOS",
    "512",
  ]) {
    assert.ok(admin.includes(recurso), `o painel admin perdeu: ${recurso}`);
  }
  const rota = ler("src/app/api/admin/figurinhas/route.ts");
  assert.ok(rota.includes("exigirAdmin"), "a rota admin não exige login");
  assert.ok(rota.includes("formatoFigurinha"), "a rota admin não valida o formato do arquivo");
  assert.ok(rota.includes("auditar"), "as mudanças não são auditadas");
  const app = ler("src/components/admin/AdminApp.tsx");
  assert.ok(app.includes("CartaoFigurinhasAdmin"), "o cartão não foi ligado ao painel admin");
});
