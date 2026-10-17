import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";
import {
  ASSINATURA_PROMO,
  BENEFICIOS,
  CABECALHO_PROMO,
  FECHO_PROMO,
  TITULO_PROMO,
  linhasDaMensagem,
  linkWhatsAppMensagem,
  mensagemCompartilhar,
} from "../src/lib/compartilhar";
import { urlPublicaDoAppTexto } from "../src/lib/url-app";

const ler = (p: string) => readFileSync(p, "utf8");

const LINK = "https://copa-links.vercel.app";

/* ------------------------------------------------------------ mensagem */

test("a mensagem de divulgação abre com o cabeçalho do CopaLinks", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.ok(msg.startsWith("🚛💙 *COPALINKS — SEU PARCEIRO NO PORTO!*"));
  assert.ok(msg.includes(CABECALHO_PROMO));
  assert.ok(msg.includes(TITULO_PROMO));
  assert.ok(msg.includes(FECHO_PROMO));
  assert.ok(msg.includes(`*${ASSINATURA_PROMO}*`));
  assert.ok(msg.trimEnd().endsWith("🚛"));
});

test("a mensagem lista os oito recursos com o texto da campanha", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.equal(BENEFICIOS.length, 8);
  for (const b of BENEFICIOS) {
    assert.ok(
      msg.includes(`${b.emoji} *${b.titulo}:* ${b.texto}`),
      `faltou o recurso: ${b.titulo}`,
    );
  }
  // recursos novos da campanha (IA e chat) precisam estar na mensagem
  assert.ok(msg.includes("*Assistente IA:*"));
  assert.ok(msg.includes("*Chat CopaLinks:*"));
});

test("a mensagem usa o negrito do WhatsApp (asterisco) e mostra o link cru", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.ok(!msg.includes("**"), "o WhatsApp não entende **: o negrito é com um asterisco só");
  assert.ok(!msg.includes("]("), "o WhatsApp não entende link em markdown: o link vai cru");
  assert.ok(msg.includes(`🔗 ${LINK}`));
  assert.ok(msg.includes("*Acesse e instale gratuitamente:*"));
});

test("as linhas da mensagem carregam os trechos em negrito", () => {
  const linhas = linhasDaMensagem(LINK);
  const negrito = linhas.flat().filter((t) => t.negrito).map((t) => t.texto);
  assert.ok(negrito.includes(CABECALHO_PROMO));
  assert.ok(negrito.includes(ASSINATURA_PROMO));
  assert.ok(negrito.includes(FECHO_PROMO));
  for (const b of BENEFICIOS) assert.ok(negrito.includes(`${b.titulo}:`));
});

test("o link de WhatsApp abre a mensagem preenchida", () => {
  const url = linkWhatsAppMensagem("Olá, mundo & tudo");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.split("?text=")[1]), "Olá, mundo & tudo");
});

/* ------------------------------------------------------------- página */

test("a página de divulgação usa a lista única de benefícios", () => {
  const comp = ler("src/components/divulgacao/DivulgacaoApp.tsx");
  assert.ok(comp.includes("BENEFICIOS"), "a página não usa a lista de recursos do app");
  for (const b of BENEFICIOS) {
    assert.ok(
      !comp.includes(b.texto),
      `a página repete o texto do recurso à mão (deve vir da lista): ${b.titulo}`,
    );
  }
  assert.ok(comp.includes("PASSOS"), "a página não usa a lista de passos");
});

test("a página de divulgação instala o app e mostra o QR Code", () => {
  const comp = ler("src/components/divulgacao/DivulgacaoApp.tsx");
  assert.ok(comp.includes("beforeinstallprompt"), "sem o botão de instalar do Chrome");
  assert.ok(comp.includes("QRCode.toDataURL"), "sem o QR Code do endereço do app");
  assert.ok(comp.includes('href="#instalar"'), "sem o atalho para o passo a passo");
  assert.ok(comp.includes("Adicionar à Tela de Início"), "sem a instrução do iPhone");
  assert.ok(comp.includes("Instalar aplicativo"), "sem a instrução do Android");
  assert.ok(comp.includes("linhasDaMensagem"), "a prévia da mensagem não usa os blocos em negrito");
});

test("a página de divulgação segue o layout do app", () => {
  const comp = ler("src/components/divulgacao/DivulgacaoApp.tsx");
  assert.ok(comp.includes("largura-aparelho"), "a página não usa a largura do aparelho");
  assert.ok(comp.includes("fundo-app") && comp.includes("bg-fundo"), "a página sem o fundo do app");
  assert.ok(!/max-w-\[(360|390|460)px\]/.test(comp), "a página voltou a uma coluna fixa");
});

test("a página de divulgação tem prévia de link com a arte certa", () => {
  const page = ler("src/app/divulgacao/page.tsx");
  assert.ok(page.includes("/images/divulgacao-card.jpg"));
  assert.ok(page.includes("canonical"));
  assert.ok(page.includes("urlPublicaDoApp"), "a página não usa a URL única do app");
  // o layout (endereço canônico do app) usa a mesma regra
  assert.ok(ler("src/app/layout.tsx").includes("urlPublicaDoApp"));
});

test("o material de divulgação do app fica na área do administrador", () => {
  const cartao = ler("src/components/admin/CartaoDivulgacaoAdmin.tsx");
  assert.ok(
    cartao.includes('href="/divulgacao"'),
    "o painel do admin não leva para a página de divulgação",
  );
  assert.ok(cartao.includes("QRCode.toDataURL"), "sem o QR Code do endereço do app");
  assert.ok(cartao.includes("linhasDaMensagem"), "a prévia da mensagem não usa os blocos em negrito");
  assert.ok(cartao.includes("IMAGEM_STATUS"), "sem a arte para status");
  assert.ok(cartao.includes("IMAGEM_DIVULGACAO"), "sem o cartão do link");
  assert.ok(
    ler("src/components/admin/AdminApp.tsx").includes("CartaoDivulgacaoAdmin"),
    "o card de divulgação não está no painel do administrador",
  );
  assert.ok(
    ler("src/app/admin/page.tsx").includes("urlPublicaDoAppTexto"),
    "o painel do admin não usa a URL única do app",
  );
  // o app do motorista não tem mais o card de divulgação
  assert.ok(
    !ler("src/components/MonitorApp.tsx").includes('href="/divulgacao"'),
    "o card de divulgação continua no app do motorista",
  );
});

/* ------------------------------------------------------------- artes */

test("as artes de divulgação existem com o tamanho certo", async () => {
  const status = await sharp("public/images/divulgacao-status.jpg").metadata();
  assert.equal(status.width, 1080, "a arte de status precisa ter 1080 px de largura");
  assert.equal(status.height, 1920, "a arte de status precisa ter 1920 px de altura");

  const card = await sharp("public/images/divulgacao-card.jpg").metadata();
  assert.equal(card.width, 1200, "o cartão do link precisa ter 1200 px de largura");
  assert.equal(card.height, 630, "o cartão do link precisa ter 630 px de altura");
});

/* -------------------------------------------------------------- url */

test("o endereço do app é o mesmo em todas as telas", () => {
  const site = process.env.SITE_URL;
  const projeto = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  try {
    assert.equal(urlPublicaDoAppTexto("copa-links.vercel.app"), "https://copa-links.vercel.app");
    assert.equal(urlPublicaDoAppTexto("localhost:3000"), "http://localhost:3000");
    process.env.SITE_URL = "https://copa-links.vercel.app/";
    assert.equal(urlPublicaDoAppTexto("localhost:3000"), "https://copa-links.vercel.app");
  } finally {
    if (site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = site;
    if (projeto === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = projeto;
  }
});
