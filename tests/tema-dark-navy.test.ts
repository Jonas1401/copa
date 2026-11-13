import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ler = (p: string) => readFileSync(p, "utf8");

/** Paleta fechada Dark Navy (identidade FertNavios) — nenhuma outra cor entra na UI. */
const PALETA = [
  "#000D16", // fundo principal
  "#071A28", // fundo dos cartões
  "#002F3B", // fundo dos painéis secundários
  "#183341", // bordas dos cartões
  "#00B8BC", // ciano principal (seleção, filtros ativos, navegação)
  "#00C853", // verde de sucesso
  "#003D35", // fundo verde escuro
  "#FFB82E", // amarelo de atenção / confirmado
  "#129DFF", // azul informativo / espera
  "#EAF4F7", // texto principal
  "#8FA8AC", // texto secundário
  "#506A75", // ícones e elementos discretos
  "#062330", // fundo das barras de progresso
] as const;

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(tsx|ts|css)$/.test(nome) ? [p] : [];
  });
}

test("globals.css declara a paleta Dark Navy completa como fonte única", () => {
  const css = ler("src/app/globals.css");
  for (const cor of PALETA) {
    assert.ok(css.includes(cor), `globals.css sem a cor da paleta ${cor}`);
  }
  // tokens semânticos das superfícies e dos status
  for (const token of [
    "--fundo-principal: #000D16",
    "--fundo-cartao: #071A28",
    "--fundo-painel: #002F3B",
    "--borda-cartao: #183341",
    "--ciano-principal: #00B8BC",
    "--verde-sucesso: #00C853",
    "--fundo-verde-escuro: #003D35",
    "--amarelo-atencao: #FFB82E",
    "--azul-informativo: #129DFF",
    "--texto-principal: #EAF4F7",
    "--texto-secundario: #8FA8AC",
    "--icone-discreto: #506A75",
    "--fundo-progresso: #062330",
    "--color-cartao: #071A28",
    "--color-painel: #002F3B",
    "--color-borda: #183341",
    "--color-progresso: #062330",
    "--color-verdeescuro: #003D35",
    "--color-discreto: #506A75",
  ]) {
    assert.ok(css.includes(token), `globals.css sem o token ${token}`);
  }
});

test("fundo sólido quase preto azul-marinho, sem degradê chamativo", () => {
  const css = ler("src/app/globals.css");
  assert.ok(css.includes("--fundo-base: #000D16"), "fundo base fora da paleta");
  assert.ok(css.includes("--fundo-gradiente: none"), "o fundo voltou a ter degradê");
  assert.ok(!css.includes("radial-gradient(80% 85%"), "degradê cobalto antigo de volta");
  // cartão principal e painel secundário sólidos, com a borda fina da paleta
  const cartao = css.slice(css.indexOf(".cartao-monitor"), css.indexOf("::selection"));
  assert.ok(cartao.includes("background: #071A28"), ".cartao-monitor fora do fundo de cartão");
  assert.ok(cartao.includes("border: 1px solid #183341"), ".cartao-monitor sem a borda da paleta");
  const painel = css.slice(css.indexOf(".painel {"), css.indexOf("/* varredura"));
  assert.ok(painel.includes("background: #002F3B"), ".painel fora do fundo de painel secundário");
  // campo de pesquisa/entrada foca no ciano; barra de progresso tem trilho próprio
  assert.ok(css.includes(".campo:focus") && css.includes("border-color: var(--color-ciano)"), ".campo sem foco ciano");
  assert.ok(css.includes(".progresso-trilho") && css.includes("background-color: #062330"), "sem trilho de progresso da paleta");
  assert.ok(css.includes(".progresso-verde") && css.includes("background-color: #00C853"), "progresso positivo sem o verde");
});

test("nenhuma cor fora da paleta nas telas (nem cobalto, violeta ou WhatsApp antigos)", () => {
  const coresValoresPainel = ["#12C8D4", "#FFB52E", "#20D879", "#FFC02E"] as const;
  const permitidasBase = new Set([...PALETA.map((c) => c.toLowerCase()), "#000", "#ffffff", "#fff"]);
  const permitidasPainel = new Set([...permitidasBase, ...coresValoresPainel.map((c) => c.toLowerCase())]);
  // #000 = máscara/sombra sobre foto; #ffffff/#fff = módulo claro do QR Code e
  // fundo de canvas de leitura (OCR) — funcionais, não são superfície da UI.
  const proibidas = [
    "#0319ba", "#021285", "#010e5a", "#010a38", "#3342d0", "#5376f4", "#619bff",
    "#8ce7ed", "#8b3dff", "#b98cf5", "#25d366", "#35e08a", "#f5b21e", "#f5c518",
  ];
  for (const arquivo of arquivos("src")) {
    if (arquivo.includes("figurinhas-pacote")) continue; // arte gerada das figurinhas, não é tema
    const ehPainelValores = arquivo.endsWith("MonitorApp.tsx") || arquivo.endsWith("globals.css");
    const permitidas = ehPainelValores ? permitidasPainel : permitidasBase;
    const paletaRgba = ehPainelValores ? [...PALETA, ...coresValoresPainel] : PALETA;
    const s = ler(arquivo);
    for (const cor of proibidas) {
      assert.ok(!s.toLowerCase().includes(cor), `${arquivo} ainda usa a cor antiga ${cor}`);
    }
    // (?<![&\w]) evita casar entidades HTML como &#160;
    for (const m of s.matchAll(/(?<![&\w])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      assert.ok(permitidas.has(m[0].toLowerCase()), `${arquivo} usa cor fora da paleta: ${m[0]}`);
    }
    for (const m of s.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
      const rgb = `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
      const naPaleta = paletaRgba.some((hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return rgb === `rgb(${r}, ${g}, ${b})`;
      });
      const neutroFoto = rgb === "rgb(0, 0, 0)" || rgb === "rgb(255, 255, 255)";
      assert.ok(naPaleta || neutroFoto, `${arquivo} usa rgba fora da paleta: ${m[0]})`);
    }
  }
});

test("aliases legados e famílias do Tailwind apontam para a paleta (sem cor extra)", () => {
  const css = ler("src/app/globals.css");
  for (const token of [
    "--color-violeta: #00B8BC", // assistente/destaques antigos viram o ciano do tema
    "--color-laranja: #FFB82E",
    "--color-ouro: #FFB82E",
    "--color-azulclaro: #129DFF",
    "--color-white: #EAF4F7",
    "--color-black: #000D16",
    "--color-red-500: #FFB82E", // alerta/erro usa o amarelo de atenção
    "--color-emerald-500: #00C853",
    "--color-cyan-300: #00B8BC",
    "--color-blue-500: #129DFF",
  ]) {
    assert.ok(css.includes(token), `globals.css sem o remapeamento ${token}`);
  }
});

test("barra do navegador e manifest acompanham o fundo Dark Navy", () => {
  assert.ok(ler("src/app/layout.tsx").includes('themeColor: "#000D16"'), "layout.tsx com themeColor antigo");
  const manifest = ler("public/manifest.webmanifest");
  assert.ok(manifest.includes('"background_color": "#000D16"'), "manifest com fundo antigo");
  assert.ok(manifest.includes('"theme_color": "#000D16"'), "manifest com theme_color antigo");
});
