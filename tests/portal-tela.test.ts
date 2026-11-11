import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Ligação da tela do PORTAL DO MOTORISTA no app e no painel.
 *
 * O motorista cadastra o CPF/senha no próprio celular (menu ⋮ → Portal do
 * motorista); o administrador acompanha em /admin. Nada de segredo fica no
 * aparelho: a tela manda para /api/portal e o servidor cifra.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const menu = () => ler("src/components/inicio/MenuConta.tsx");
const app = () => ler("src/components/MonitorApp.tsx");
const tela = () => ler("src/components/inicio/PortalMotorista.tsx");
const cartao = () => ler("src/components/admin/CartaoPortalAdmin.tsx");
const admin = () => ler("src/components/admin/AdminApp.tsx");
const rota = () => ler("src/app/api/portal/route.ts");
const rotaAdmin = () => ler("src/app/api/admin/portal/route.ts");

test("o menu ⋮ abre o portal do motorista", () => {
  const m = menu();
  assert.match(m, /Portal do motorista/, "o item do portal saiu do menu ⋮");
  assert.match(m, /onAbrirPortal\?/, "o menu não recebe a ação de abrir o portal");
  assert.match(m, /\{onAbrirPortal &&/, "o item aparece mesmo sem a ação ligada");
  const cab = ler("src/components/inicio/Cabecalho.tsx");
  assert.match(cab, /onAbrirPortal=\{onAbrirPortal\}/, "o cabeçalho não repassa a ação");
});

test("o app abre a tela do portal para o motorista logado", () => {
  const a = app();
  assert.match(a, /import PortalMotorista/, "a tela do portal não está ligada no app");
  assert.match(a, /\{portalAberto && motorista &&/, "a tela pode abrir sem motorista (sem sessão)");
  assert.match(a, /onAbrirPortal=\{\(\) => \{/, "o botão do menu não abre a tela");
  // O estado atual é lido antes de abrir (nada de mostrar "sem cadastro" por engano).
  assert.match(a, /fetch\("\/api\/portal", \{ cache: "no-store" \}\)/, "o app não busca o estado do portal");
});

test("a tela do motorista pede CPF e senha e nunca guarda no aparelho", () => {
  const t = tela();
  assert.match(t, /CPF \(o mesmo do login do portal\)/, "sem o campo de CPF");
  assert.match(t, /Senha do portal/, "sem o campo de senha");
  assert.match(t, /type=\{verSenha \? "text" : "password"\}/, "a senha deixou de ser mascarada por padrão");
  assert.match(t, /method: "POST"[\s\S]{0,200}JSON\.stringify\(\{ cpf, senha \}\)/, "a tela não envia CPF/senha para a API");
  assert.match(t, /method: "DELETE"/, "não dá para apagar os dados do portal");
  assert.match(t, /cifrados no servidor/, "a tela não avisa que os dados ficam cifrados no servidor");
  // Nada de localStorage/sessionStorage nesta tela: credencial não fica no aparelho.
  assert.ok(!/localStorage|sessionStorage/.test(t), "a tela guardou credencial no navegador");
});

test("a API do motorista só devolve dado mascarado e exige a sessão do aparelho", () => {
  const r = rota();
  assert.match(r, /motoristaDaSessao\(\)/, "a rota não usa a sessão do motorista");
  assert.match(r, /naoAutorizadoMotorista\(\)/, "a rota deixa passar sem sessão");
  assert.match(r, /acessoPublico\(/, "a rota não usa o formato seguro do acesso");
  assert.match(r, /cpfPlausivel\(/, "a rota aceita CPF inválido");
  assert.match(r, /export async function DELETE/, "sem rota para apagar os dados");
  // O navegador nunca recebe cpf/senha em texto: só o objeto público.
  assert.ok(!/NextResponse\.json\(\s*acesso\b/.test(r), "a rota devolveu a linha crua do banco");
});

test("o painel do administrador mostra o monitoramento do portal", () => {
  assert.match(admin(), /import CartaoPortalAdmin/, "o cartão do portal não está no /admin");
  assert.match(admin(), /<CartaoPortalAdmin \/>/, "o cartão do portal não é desenhado");
  const c = cartao();
  assert.match(c, /\/api\/admin\/portal/, "o cartão não fala com a API do administrador");
  assert.match(c, /Ler agora/, "sem a leitura sob demanda pelo painel");
  assert.match(c, /Remover acesso/, "sem o botão de remover o acesso (apaga a senha)");
  assert.match(c, /Confirmar remoção/, "a remoção acontece sem confirmação");
  assert.match(c, /senha ••••\{m\.senhaFinal4\}/, "o painel deixou de mascarar a senha");
  assert.match(c, /Ver o que foi lido/, "o administrador não consegue ver a página lida");
});

test("a API do administrador exige login, nunca devolve segredo e audita a leitura", () => {
  const r = rotaAdmin();
  assert.match(r, /exigirAdmin\(\)/, "a rota do painel não exige administrador");
  assert.match(r, /auditar\(/, "a leitura sob demanda não vai para a auditoria");
  assert.ok(!/cpf:\s*[a-z]/i.test(r), "a rota do painel expõe CPF");
  assert.match(r, /removerAcessoPortal/, "a rota não permite remover o acesso");
});

test("o cron lê o portal sem travar a fila nem os navios", () => {
  const cron = ler("src/app/api/cron/route.ts");
  assert.match(cron, /monitorarTodos/, "o cron não chama o monitoramento do portal");
  assert.match(cron, /monitorarTodos\(\)\.catch\(\(\) => null\)/, "uma falha do portal pode derrubar o cron");
  assert.match(cron, /tarefaPortal/, "o portal não roda junto do restante do ciclo");
});

/* ------------------------------------------------------------------ saída */

const saidaFonte = () => ler("src/lib/portal-saida.ts");
const rotaSaida = () => ler("src/app/api/admin/portal/saida/route.ts");

test("o teste da saída fica na área do administrador e exige login", () => {
  assert.ok(ler("src/app/api/admin/portal/saida/route.ts").includes('exigirAdmin()'), "a rota da saída não exige administrador");
  assert.match(rotaSaida(), /auditar\(/, "ligar o modo / ler o portal não vai para a auditoria");
  assert.match(cartao(), /Saída do ponto \(teste\)/, "o cartão do /admin não mostra o teste da saída");
  assert.match(cartao(), /\/api\/admin\/portal\/saida/, "o cartão não fala com a rota da saída");
  assert.match(cartao(), /Ler o portal agora/, "sem o botão de leitura real no painel");
  assert.match(cartao(), /Simular mensagem/, "sem a simulação (nada é enviado)");
  assert.match(cartao(), /Saiu para o trabalho/, "sem o cenário de saída para o trabalho");
  assert.match(cartao(), /Foi para a dispensa/, "sem o cenário de dispensa");
  assert.match(cartao(), /Mensagem que o motorista recebe/, "o painel não mostra a mensagem pronta");
});

test("o modo de teste nunca manda mensagem para o celular do motorista", () => {
  const f = saidaFonte();
  assert.match(f, /export function podeEnviarSaida/, "sem a regra de destino por modo");
  assert.match(f, /modo === "motoristas"\) return true/, "o modo desligado/teste pode enviar");
  assert.match(f, /opcoes\.origem === "admin" && modo === "somente_admin" \? "teste"/, "o painel marca como teste");
  assert.match(f, /Modo de teste do administrador: este aviso não vai para o celular/, "sem o aviso de que nada foi enviado");
  assert.match(rotaSaida(), /acao === "simular"/, "a simulação não existe na rota");
  assert.match(rotaSaida(), /simulado: true/, "a simulação pode acabar enviando");
});

test("a saída entra no cron pelo SAIU da fila e é lida no portal do motorista", () => {
  const f = saidaFonte();
  assert.match(f, /export async function verificarSaidasRecentes/, "sem a rotina automática");
  assert.match(f, /pontos\.status.*SAIU|sql`\$\{pontos\.status\} = 'SAIU'`/, "a rotina não olha o status SAIU dos pontos");
  assert.match(f, /lerTelasDoMotorista/, "a rotina não lê as telas do portal");
  assert.match(f, /credita|credenciaisDoMotorista/, "a rotina não usa as credenciais do próprio motorista");
  const estado = ler("src/lib/estado.ts");
  assert.match(estado, /consultarPortalNaSaida/, "a saída não consulta o portal antes do aviso");
  assert.ok(estado.indexOf("await consultarPortalNaSaida") < estado.indexOf('await dispararPush("saiu"'));
});

test("o portal não mostra um cartão na tela Início e continua acessível pelo menu ⋮", () => {
  const a = app();
  assert.doesNotMatch(a, /import AcessoPortal|<AcessoPortal|portalResumo/, "o cartão do portal continua na Início");
  assert.match(menu(), /Portal do motorista/, "o acesso pelo menu ⋮ deve continuar disponível");
});

test("a saída é conferida durante a varredura, sem um segundo aviso automático", () => {
  const rota = ler("src/app/api/estado/route.ts");
  assert.match(rota, /varrerSeVelho/);
  assert.match(rota, /garantirTabelasPortal/);
  assert.doesNotMatch(rota, /tickSaidaPortal/);
  assert.doesNotMatch(ler("src/app/api/cron/route.ts"), /verificarSaidasRecentes/);
  assert.match(ler("src/lib/push.ts"), /destino não foi confirmado/);
});

test("o botão “Salvar e ler o portal” é o amarelo do tema, com texto escuro", () => {
  const t = tela();
  const botao = t.match(/onClick=\{\(\) => void salvar\(\)\}[\s\S]{0,200}?className="([^"]+)"/);
  assert.ok(botao, "não achei o botão que salva o CPF e a senha do portal");
  const classes = botao[1].split(/\s+/);
  // .ouro é o botão amarelo do app (globals.css). Não trocar por `pill bg-…`:
  // a .pill tem fundo escuro próprio e fica fora das camadas do Tailwind, então
  // vence qualquer `bg-…`; com texto escuro por cima, o rótulo sumia.
  assert.ok(classes.includes("ouro"), "o botão de salvar deixou de usar o amarelo do tema (.ouro)");
  assert.ok(!classes.includes("pill"), "o botão de salvar voltou a usar a .pill (fundo escuro)");
  assert.match(t, /"Salvar e ler o portal"/, "o rótulo do botão mudou");
  const css = ler("src/app/globals.css");
  const ouro = css.slice(css.indexOf(".ouro {"), css.indexOf(".ouro:hover"));
  assert.match(ouro, /background: #FFB82E;/, ".ouro deixou de ser o amarelo da paleta");
  assert.match(ouro, /color: #000D16;/, ".ouro deixou de ter texto escuro (contraste)");
});
