import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Menu ⋮ do canto superior esquerdo da foto do caminhão.
 *
 * Pedido do Jonas: o menu discreto de três pontinhos no canto superior
 * esquerdo deve conter só as ações para trocar o nome, ativar notificações e
 * abrir o painel de administração — sem o atalho "Sobre o CopaLinks".
 */

const ler = (p: string) => readFileSync(p, "utf8");
const menu = () => ler("src/components/inicio/MenuConta.tsx");
const cabecalho = () => ler("src/components/inicio/Cabecalho.tsx");
const app = () => ler("src/components/MonitorApp.tsx");

test("o menu ⋮ usa três pontinhos e fica no canto superior esquerdo do topo", () => {
  const m = menu();
  assert.ok(m.includes("EllipsisVertical"), "o menu deixou de usar o ícone de três pontinhos");
  assert.ok(!m.includes("MenuIcon") && !m.includes("Hamburger"), "o menu virou hambúrguer (o pedido é ⋮)");
  // É o primeiro controle do cabeçalho: antes do bloco alinhado à direita.
  const c = cabecalho();
  const posMenu = c.indexOf("<MenuConta");
  const posDireita = c.indexOf("ml-auto");
  assert.ok(posMenu > 0, "o cabeçalho não desenha o menu ⋮");
  assert.ok(posMenu < posDireita, "o menu ⋮ não está no canto esquerdo (antes dos controles da direita)");
});

test("o menu é discreto como os outros controles do topo", () => {
  const m = menu();
  assert.ok(m.includes("h-11 w-11"), "o menu perdeu o ganho de toque de 44 px");
  assert.ok(m.includes("bg-black/20"), "o menu perdeu o fundo discreto sobre a foto");
  assert.ok(m.includes("border-white/10"), "o menu perdeu a borda discreta");
  assert.ok(m.includes("size={17}"), "o ícone do menu deixou de ser pequeno");
  assert.ok(!m.includes("bg-[#0b2152]") && !m.includes("border-[#2a5bb0]"), "o menu voltou a ter caixa azul pesada");
});

test("o menu reúne exatamente o que já existe: nome, notificações e admin", () => {
  const m = menu();
  assert.ok(m.includes("Trocar meu nome"), "sem a troca do nome do perfil");
  assert.ok(m.includes("Ativar notificações"), "sem o botão de ativar as notificações");
  assert.ok(/href="\/admin"/.test(m), "sem o acesso ao painel de administração");
  assert.ok(m.includes("Painel de administração"), "o link do admin perdeu o rótulo");
  // O menu reutiliza as ações existentes, sem chamadas próprias.
  const a = app();
  assert.ok(/onRenomear=\{renomear\}/.test(a), "o menu não usa a mesma função de renomear da aba Sobre");
  assert.ok(
    /onAtivarNotificacoes=\{\(\) => setPainelNotif\("geral"\)\}/.test(a),
    "o menu não abre o mesmo painel de notificações da aba Sobre",
  );
  assert.ok(!/fetch\(\s*[`"]\/api\/motoristas/.test(m), "o menu criou a própria chamada em vez de reutilizar a da aba Sobre");
});

test("a aba Sobre continua com o link do painel de administração", () => {
  const a = app();
  assert.ok(
    /Acesso discreto à Área do Administrador[\s\S]{0,400}href="\/admin"/.test(a),
    "o link do admin saiu da aba Sobre (o pedido era só acrescentar o menu ⋮)",
  );
});

test("o menu não mostra mais o cartão de informações Sobre o CopaLinks", () => {
  const m = menu();
  assert.ok(!m.includes("Sobre o CopaLinks"), "o atalho Sobre ainda aparece no menu");
  assert.ok(!m.includes("Motoristas, notificações e admin"), "a descrição removida ainda aparece no menu");
  assert.ok(!m.includes("onAbrirSobre"), "o menu ainda contém uma ação para abrir Sobre");
  // A aba Sobre continua acessível pela navegação própria do app.
  assert.match(app(), /aba === "sobre"/);
});

test("o menu abre ancorado no botão, fecha com Esc/clique fora e não vaza da tela", () => {
  const m = menu();
  assert.ok(m.includes("fixed inset-0 z-[70]"), "sem a camada que fecha ao tocar fora");
  assert.ok(m.includes('evento.key === "Escape"'), "o menu não fecha com Esc");
  assert.ok(m.includes("getBoundingClientRect"), "o painel não é ancorado no botão");
  assert.ok(m.includes("Math.min(248, window.innerWidth - 24)"), "o painel pode vazar à direita em tela estreita");
  assert.ok(m.includes("max-h-[calc(100dvh-96px)]"), "o painel pode passar do rodapé da tela");
});
