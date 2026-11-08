import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";
import {
  ASSINATURA_PROMO,
  BENEFICIOS,
  CABECALHO_PROMO,
  CHAMADA_LINK_PROMO,
  FECHO_PROMO,
  IMAGEM_COMPARTILHAR,
  TITULO_PROMO,
  compartilharAplicativo,
  linhasDaMensagem,
  linkWhatsAppMensagem,
  mensagemCompartilhar,
  normalizarLinkCompartilhar,
} from "../src/lib/compartilhar";
import { urlPublicaDoAppTexto } from "../src/lib/url-app";

const ler = (p: string) => readFileSync(p, "utf8");

const LINK = "https://copa-links.vercel.app";

const MENSAGEM_ESPERADA = [
  "🚛💙 *Conheça o CopaLinks!*",
  "",
  "Um aplicativo desenvolvido para facilitar o dia a dia dos motoristas no Porto de Paranaguá.",
  "",
  "📍 Monitoramento dos pontos da Copadubo",
  "🔔 Alertas de chamadas",
  "🌦️ Previsão do tempo",
  "🧮 Cálculo de frete",
  "🔧 Assistente mecânico inteligente com IA",
  "📲 Contatos e informações úteis",
  "💬 Chat para compartilhar informações com outros motoristas",
  "🚢 Informações sobre a atracação dos navios de fertilizantes",
  "",
  "Tudo isso em um só aplicativo, gratuito e pensado para quem vive a rotina do porto!",
  "",
  "🔗 *Acesse e conheça:*",
  "https://copa-links.vercel.app/",
  "",
  "💙 *CopaLinks — Conectar • Facilitar • Evoluir.*",
].join("\n");

/* ------------------------------------------------------------ mensagem */

test("a mensagem de compartilhamento corresponde exatamente ao texto oficial do CopaLinks", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.equal(msg, MENSAGEM_ESPERADA);
  assert.equal(mensagemCompartilhar(`${LINK}/`), MENSAGEM_ESPERADA);
  assert.ok(msg.startsWith("🚛💙 *Conheça o CopaLinks!*"));
  assert.ok(msg.includes(CABECALHO_PROMO));
  assert.ok(msg.includes(TITULO_PROMO));
  assert.ok(msg.includes(FECHO_PROMO));
  assert.ok(msg.includes(`*${CHAMADA_LINK_PROMO}*`));
  assert.ok(msg.includes(`*${ASSINATURA_PROMO}*`));
  assert.ok(msg.endsWith("💙 *CopaLinks — Conectar • Facilitar • Evoluir.*"));
});

test("a mensagem lista os oito recursos do aplicativo no Porto de Paranaguá", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.equal(BENEFICIOS.length, 8);
  for (const b of BENEFICIOS) {
    assert.ok(
      msg.includes(`${b.emoji} ${b.titulo}`),
      `faltou o recurso: ${b.titulo}`,
    );
  }
  assert.ok(msg.includes("🔧 Assistente mecânico inteligente com IA"));
  assert.ok(msg.includes("💬 Chat para compartilhar informações com outros motoristas"));
  assert.ok(msg.includes("🚢 Informações sobre a atracação dos navios de fertilizantes"));
});

test("a mensagem usa o negrito do WhatsApp (asterisco simples) e mostra o link cru com barra", () => {
  const msg = mensagemCompartilhar(LINK);
  assert.ok(!msg.includes("**"), "o WhatsApp não entende **: o negrito é com um asterisco só");
  assert.ok(!msg.includes("]("), "o WhatsApp não entende link em markdown: o link vai cru");
  assert.equal(normalizarLinkCompartilhar(LINK), "https://copa-links.vercel.app/");
  assert.ok(msg.includes("🔗 *Acesse e conheça:*\nhttps://copa-links.vercel.app/"));
});

test("as linhas da mensagem carregam os trechos em negrito", () => {
  const linhas = linhasDaMensagem(LINK);
  const negrito = linhas.flat().filter((t) => t.negrito).map((t) => t.texto);
  assert.deepEqual(negrito, [CABECALHO_PROMO, CHAMADA_LINK_PROMO, ASSINATURA_PROMO]);
});

test("o link de WhatsApp abre a mensagem preenchida", () => {
  const url = linkWhatsAppMensagem("Olá, mundo & tudo");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.split("?text=")[1]), "Olá, mundo & tudo");
});

/* ------------------------------------------- compartilhamento com imagem */

test("o botão de compartilhar envia a imagem do app junto com a mensagem completa", async () => {
  const bufImagem = readFileSync("public/images/compartilhar.jpg");
  const windowOriginal = globalThis.window;
  const navigatorOriginal = globalThis.navigator;
  const fetchOriginal = globalThis.fetch;

  let dadosRecebidos: ShareData | null = null;
  let urlBuscada = "";

  try {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urlBuscada = String(input);
      return new Response(bufImagem, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }) as typeof fetch;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        canShare: (d?: ShareData) => Boolean(d?.files?.length),
        share: async (d: ShareData) => {
          dadosRecebidos = d;
        },
      },
      configurable: true,
      writable: true,
    });

    const resultado = await compartilharAplicativo(LINK);
    assert.equal(resultado, "compartilhou");
    assert.equal(urlBuscada, IMAGEM_COMPARTILHAR);
    assert.ok(dadosRecebidos, "navigator.share não foi chamado");
    const compartilhado = dadosRecebidos as ShareData;
    assert.equal(compartilhado.text, MENSAGEM_ESPERADA);
    assert.equal(compartilhado.files?.length, 1);
    assert.equal(compartilhado.files?.[0]?.name, "copalinks.jpg");
    assert.equal(compartilhado.files?.[0]?.type, "image/jpeg");
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: windowOriginal,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: navigatorOriginal,
      configurable: true,
      writable: true,
    });
    globalThis.fetch = fetchOriginal;
  }
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
  assert.ok(comp.includes("IMAGEM_COMPARTILHAR"), "a prévia da mensagem não exibe a imagem do app");
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
  assert.ok(cartao.includes("IMAGEM_COMPARTILHAR"), "sem a imagem de compartilhamento na prévia");
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
  // o botão de compartilhar do cabeçalho do app usa o compartilhamento com imagem
  assert.ok(
    ler("src/components/MonitorApp.tsx").includes("compartilharAplicativo"),
    "o botão de compartilhar do cabeçalho não usa compartilharAplicativo",
  );
});

/* ------------------------------------------------------------- artes */

test("as artes de compartilhamento e divulgação existem com o tamanho certo e cores Dark Navy", async () => {
  const compartilhar = await sharp("public/images/compartilhar.jpg").metadata();
  assert.equal(compartilhar.width, 1200, "a imagem de compartilhar precisa ter 1200 px de largura");
  assert.equal(compartilhar.height, 630, "a imagem de compartilhar precisa ter 630 px de altura");

  const status = await sharp("public/images/divulgacao-status.jpg").metadata();
  assert.equal(status.width, 1080, "a arte de status precisa ter 1080 px de largura");
  assert.equal(status.height, 1920, "a arte de status precisa ter 1920 px de altura");

  const card = await sharp("public/images/divulgacao-card.jpg").metadata();
  assert.equal(card.width, 1200, "o cartão do link precisa ter 1200 px de largura");
  assert.equal(card.height, 630, "o cartão do link precisa ter 630 px de altura");

  // Garante que as três artes usam o fundo Dark Navy (#000D16 / #071A28 / #002F3B)
  // nas bordas e nunca o azul cobalto antigo (#0216a5, B > 120).
  for (const caminho of [
    "public/images/compartilhar.jpg",
    "public/images/divulgacao-card.jpg",
    "public/images/divulgacao-status.jpg",
  ]) {
    const canto = await sharp(caminho)
      .extract({ left: 8, top: 8, width: 16, height: 16 })
      .raw()
      .toBuffer();
    const r = canto[0];
    const g = canto[1];
    const b = canto[2];
    assert.ok(
      r < 25 && g < 60 && b < 75,
      `${caminho} não está com o fundo Dark Navy do tema (RGB ${r},${g},${b})`,
    );
  }
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
