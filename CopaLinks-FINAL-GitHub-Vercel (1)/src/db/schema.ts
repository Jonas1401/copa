import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Pontos que o mestre está acompanhando (a lista "SEUS PONTOS, MESTRE").
export const pontos = pgTable("pontos", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(), // TRUCK | CAVALO
  livro: text("livro").notNull(), // A | B | M
  numero: integer("numero").notNull(),
  // Posição na tabela do site: quantos pontos estão na frente deste.
  naFrente: integer("na_frente").default(0).notNull(),
  status: text("status").default("AGUARDANDO").notNull(), // AGUARDANDO | NA VEZ | SAIU
  origem: text("origem").default("manual").notNull(), // manual | intranet
  // Última vez que o ponto apareceu dentro de alguma tabela do site.
  vistoEm: timestamp("visto_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  chamadoEm: timestamp("chamado_em", { withTimezone: true }),
  saidaEm: timestamp("saida_em", { withTimezone: true }),
  ordem: integer("ordem").default(0).notNull(),
  // Motorista que cadastrou o ponto (null = cadastrado antes da lista existir).
  motoristaId: integer("motorista_id"),
  // Alerta "perto da vez": avisa quando restarem N ou menos na frente (null = desligado).
  alertaPerto: integer("alerta_perto"),
}, (t) => [unique("ponto_unico").on(t.tipo, t.livro, t.numero)]);

// Lista de motoristas (aba "Motoristas"): criada na 1ª abertura do app.
export const motoristas = pgTable("motoristas", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  // Ponto informado na 1ª abertura (é o único que aparece na lista).
  pontoTipo: text("ponto_tipo"),
  pontoLivro: text("ponto_livro"),
  pontoNumero: integer("ponto_numero"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Cada varredura pelo site monitorado (3 quadros = 6 tabelas).
export const amostras = pgTable("amostras", {
  id: serial("id").primaryKey(),
  origem: text("origem").notNull(), // intranet | offline
  dados: jsonb("dados").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Registro da operação: chamadas, saídas e cadastros.
export const eventos = pgTable("eventos", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),
  tipo: text("tipo").notNull(),
  livro: text("livro").notNull(),
  numero: integer("numero").notNull(),
  acao: text("acao").notNull(), // chamou | saiu | voltou | cadastrou | removeu | atualizou
  mensagem: text("mensagem").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Assinaturas Web Push dos navegadores que autorizaram as notificações.
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  dispositivo: text("dispositivo").default("").notNull(),
  ativa: integer("ativa").default(1).notNull(),
  // Motorista dono deste aparelho (recebe os avisos dos pontos dele).
  motoristaId: integer("motorista_id"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  ultimoEnvioEm: timestamp("ultimo_envio_em", { withTimezone: true }),
});

// Configuração interna do servidor (ex.: par de chaves VAPID quando não há
// variável de ambiente). Nunca é exposta por nenhuma rota.
export const configuracao = pgTable("configuracao", {
  chave: text("chave").primaryKey(),
  valor: text("valor").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Controle de duplicidade: cada tag só é disparada uma única vez.
export const notificacoes = pgTable("notificacoes", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull().unique(),
  titulo: text("titulo").notNull(),
  corpo: text("corpo").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

/* ===================================================== ADMINISTRAÇÃO ===== */

// Administradores do CopaLinks (acesso à tela "Configurações de API").
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  usuario: text("usuario").notNull().unique(),
  // scrypt: "salt:hash" (hex). A senha nunca é guardada em texto.
  senhaHash: text("senha_hash").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
});

// Sessões de administrador: o navegador guarda só um token aleatório em
// cookie httpOnly; aqui fica o hash dele.
export const adminSessoes = pgTable("admin_sessoes", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// API Keys e credenciais das integrações, cifradas com AES-256-GCM.
// `final4` existe só para a tela mostrar "••••1234" sem decifrar nada.
export const segredos = pgTable("segredos", {
  chave: text("chave").primaryKey(), // ex.: COMPOSIO_API_KEY
  cifrado: text("cifrado").notNull(), // base64(iv | tag | dados)
  final4: text("final4").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por"),
});

// Último resultado do "Testar conexão" de cada integração.
export const integracoesStatus = pgTable("integracoes_status", {
  id: text("id").primaryKey(), // composio | clima | whatsapp | ia | notificacoes | banco
  status: text("status").notNull(), // conectado | erro | nao_configurado
  mensagem: text("mensagem").notNull(),
  verificadoEm: timestamp("verificado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Auditoria: quem mudou o quê e quando. NUNCA guarda o valor das chaves.
export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id"),
  adminNome: text("admin_nome").notNull(),
  integracao: text("integracao").notNull(),
  acao: text("acao").notNull(),
  detalhe: text("detalhe").default("").notNull(),
  ip: text("ip").default("").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Chat dos motoristas: recados sobre o trabalho (fila, pátio, balança, tempo...).
export const chatMensagens = pgTable("chat_mensagens", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull(),
  nome: text("nome").notNull(),
  texto: text("texto").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

