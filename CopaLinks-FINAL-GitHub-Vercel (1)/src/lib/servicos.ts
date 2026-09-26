/**
 * Cards de SERVIÇOS da tela inicial e os contatos.
 *
 * Para ligar um card, preencha o `href`:
 *   - link externo: "https://..."  → abre numa aba nova
 *   - página do app: "/alguma-rota" → abre no próprio app
 * Com `href` vazio o card aparece normalmente e avisa "Link em breve".
 */

export type CorServico =
  | "laranja"
  | "roxo"
  | "verde"
  | "azul"
  | "vermelho"
  | "turquesa"
  | "indigo";

export type IconeServico =
  | "cadeado"
  | "documento"
  | "ficha"
  | "calculadora"
  | "telefone"
  | "escudo"
  | "navio";

export type Servico = {
  id: string;
  titulo: string;
  subtitulo: string;
  cor: CorServico;
  icone: IconeServico;
  href: string;
};

export const SERVICOS: Servico[] = [
  {
    id: "login",
    titulo: "Login do aplicativo",
    subtitulo: "Acesse sua conta",
    cor: "laranja",
    icone: "cadeado",
    href: "https://portal.copadubo.com.br/login.php",
  },
  {
    id: "consulta-ponto",
    titulo: "Consulta de Ponto",
    subtitulo: "Tela de caminhões ativos",
    cor: "roxo",
    icone: "documento",
    // Mesmo quadro que o monitor varre a cada 5 segundos.
    href: "https://intranet.copadubo.com.br/ponto/",
  },
  {
    id: "appa",
    titulo: "Informações APPA",
    subtitulo: "Navios e manobras",
    cor: "verde",
    icone: "ficha",
    href: "https://berth-bloom-buddy.lovable.app/",
  },
  {
    id: "frete",
    titulo: "Cálculo de Frete",
    subtitulo: "Leitura de ticket",
    cor: "azul",
    icone: "calculadora",
    // Calculadora do motorista (soma o ticket Quant × Valor).
    href: "/frete",
  },
  {
    id: "contatos",
    titulo: "Contatos Operacionais",
    subtitulo: "WhatsApp da equipe",
    cor: "vermelho",
    icone: "telefone",
    href: "/contatos",
  },
  {
    id: "sinprapar",
    titulo: "SINPRAPAR",
    subtitulo: "Manobras previstas",
    cor: "indigo",
    icone: "navio",
    href: "https://www.sinprapar.com.br/PREV.HTM",
  },
];

/**
 * Contatos da página /contatos (card "Contatos Operacionais").
 * `numero` = como aparece na tela; o link do WhatsApp é montado a partir dos
 * dígitos (DDI 55 + DDD + número).
 */
export type Contato = { nome: string; numero: string };

export const CONTATOS: Contato[] = [
  { nome: "Plantão Porto", numero: "(41) 98417-5303" },
  { nome: "Plantão Fospar", numero: "(41) 99128-2367" },
  { nome: "Encarregado", numero: "(41) 99169-2656" },
  { nome: "Barracão de Verificação", numero: "(41) 99112-4254" },
  { nome: "Agendamento Fospar", numero: "(41) 93618-2517" },
  { nome: "SEV Copadubo", numero: "(41) 9253-3460" },
  { nome: "Robô Copadubo", numero: "(41) 98854-7616" },
  { nome: "Novo Robô Copadubo", numero: "(41) 2152-2816" },
];

export function linkWhatsApp(numero: string) {
  return `https://wa.me/55${numero.replace(/\D/g, "")}`;
}
