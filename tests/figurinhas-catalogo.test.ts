import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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

test("categorias padrão: as 4 do CopaLinks, em ordem e sem repetição", () => {
  assert.deepEqual(CATEGORIAS_PADRAO.map((c) => c.chave), ["caminhoes", "motoristas", "porto", "copalinks"]);
  assert.deepEqual(CATEGORIAS_PADRAO.map((c) => c.nome), ["Caminhões", "Motoristas", "Porto", "CopaLinks"]);
  assert.equal(new Set(CATEGORIAS_PADRAO.map((c) => c.chave)).size, 4);
  assert.ok(CATEGORIAS_PADRAO.every((c) => c.pacote === "copalinks"));
  for (const c of CATEGORIAS_PADRAO) assert.equal(chaveCategoria(c.nome) !== null || chaveCategoria(c.chave) !== null, true);
});

test("mensagem e push da figurinha têm formato próprio (não confunde com texto)", () => {
  assert.equal(textoFigurinhaEnviada("Caminhão feliz"), "🎨 Caminhão feliz");
  assert.equal(pushFigurinhaEnviada("Caminhão feliz"), '🖼️ Enviou a figurinha "Caminhão feliz"');
  assert.ok(textoFigurinhaEnviada("x".repeat(600)).length <= 500);
});

/* ------------------------------------------ pacote oficial semeado no banco */

test("pacote inicial: figurinhas válidas, WebP com assinatura correta e dentro do limite", () => {
  assert.ok(PACOTE_FIGURINHAS.length >= 16, "o pacote inicial precisa ter a biblioteca completa");
  for (const f of PACOTE_FIGURINHAS) {
    assert.ok(nomeFigurinha(f.nome), `nome inválido: ${f.nome}`);
    assert.ok(CATEGORIAS_PADRAO.some((c) => c.chave === f.categoria), `categoria desconhecida: ${f.categoria}`);
    assert.equal(f.mime, "image/webp");
    const bytes = Buffer.from(f.base64, "base64");
    assert.ok(bytes.length > 0 && bytes.length <= TAMANHO_MAX_FIGURINHA, `${f.slug} fora do tamanho`);
    assert.deepEqual(formatoFigurinha(new Uint8Array(bytes)), { mime: "image/webp", extensao: "webp" }, f.slug);
  }
  const nomes = PACOTE_FIGURINHAS.map((f) => f.nome);
  assert.equal(new Set(nomes).size, nomes.length, "nomes repetidos no pacote");
  const slugs = PACOTE_FIGURINHAS.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs repetidos no pacote");
  // As 4 categorias têm figurinhas.
  for (const c of CATEGORIAS_PADRAO) {
    assert.ok(PACOTE_FIGURINHAS.some((f) => f.categoria === c.chave), `sem figurinhas em ${c.chave}`);
  }
});

/* ---------------------------------------------- o chat continua inteiro */

const ler = (caminho: string) => readFileSync(caminho, "utf8");

test("seletor do chat: abas Emojis e Figurinhas, categorias e grade de 4 por linha", () => {
  const s = ler("src/components/chat/ChatMotoristas.tsx");
  // Abas de sempre preservadas.
  assert.ok(s.includes('"emojis" ? "😀 Emojis" : "🚛 Figurinhas"'), "as abas Emojis/Figurinhas mudaram");
  assert.ok(s.includes("EMOJIS.map"), "o seletor de emojis sumiu");
  assert.ok(s.includes("FIGURINHAS.map"), "as figurinhas de recado (emoji+frase) foram removidas");
  // Recurso novo: categorias do catálogo e grade com 4 figurinhas por linha.
  assert.ok(s.includes('aria-label="Categorias de figurinhas"'), "faltou o seletor de categorias");
  assert.ok(s.includes("iconeCategoria"), "as categorias não ganham ícone");
  assert.ok(s.includes("grid grid-cols-4 gap-2"), "as figurinhas não saem em grade de 4 por linha");
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
