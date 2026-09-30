import {
  index,
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
  // Cada motorista monitora os próprios pontos: o mesmo número pode estar em
  // dois motoristas (cada um com o próprio aviso), mas não repetido no mesmo.
}, (t) => [unique("ponto_unico_motorista").on(t.motoristaId, t.tipo, t.livro, t.numero)]);

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

// Motoristas que silenciaram SÓ as notificações do chat (os avisos do ponto
// continuam chegando). Tabela separada: nenhuma consulta existente muda.
export const chatSilenciados = pgTable("chat_silenciados", {
  motoristaId: integer("motorista_id").primaryKey().references(() => motoristas.id, { onDelete: "cascade" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Alerta individual do administrador para um motorista (ex.: notificações
// desativadas). Aparece no app em tela cheia e só fecha quando o motorista
// ativa as notificações naquele aparelho (resolvido_em preenchido).
export const alertasMotorista = pgTable("alertas_motorista", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull().references(() => motoristas.id, { onDelete: "cascade" }),
  mensagem: text("mensagem").notNull(),
  adminNome: text("admin_nome").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
}, (t) => [index("alertas_motorista_motorista_idx").on(t.motoristaId)]);

// Identidade deste aparelho: somente o hash do token fica no PostgreSQL.
export const motoristaSessoes = pgTable("motorista_sessoes", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull().references(() => motoristas.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("motorista_sessoes_motorista_id_idx").on(t.motoristaId)]);

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

// Teste de notificação "com o app fechado": o aparelho pede o teste e quem
// envia é o ciclo de leitura do servidor (/api/cron), sem a página aberta.
export const testesPush = pgTable("testes_push", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  pedidoEm: timestamp("pedido_em", { withTimezone: true }).defaultNow().notNull(),
  // Só sai no primeiro ciclo depois deste horário (tempo para fechar o app).
  enviarApos: timestamp("enviar_apos", { withTimezone: true }).notNull(),
  processadoEm: timestamp("processado_em", { withTimezone: true }),
  resultado: text("resultado"), // enviando | enviado | falhou | sem_inscricao
}, (t) => [index("testes_push_endpoint_idx").on(t.endpoint)]);

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
// Mensagens do SISTEMA (ex.: alertas do clima) usam motorista_id = 0.
export const chatMensagens = pgTable("chat_mensagens", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull(),
  nome: text("nome").notNull(),
  texto: text("texto").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Conversa privada de cada motorista com o assistente de IA (mecânica pesada
// + ajuda do app). Papel: "user" (pergunta) ou "assistant" (resposta).
export const iaMensagens = pgTable("ia_mensagens", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull(),
  papel: text("papel").notNull(),
  texto: text("texto").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

/* ======================== MONITOR WHATSAPP (opt-in) ======================== */
// Independentes dos pontos da fila: adicionar um código aqui não cria sinais
// de entrada/saída da Copadubo. Cada motorista gerencia somente os seus.
export const monitorCodes = pgTable("monitor_codes", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").notNull().references(() => motoristas.id, { onDelete: "cascade" }),
  codigo: text("codigo").notNull(), // A184, B22, M69 (sem zeros à esquerda)
  ativo: integer("ativo").default(1).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("monitor_codes_dono_codigo_unico").on(t.motoristaId, t.codigo),
  index("monitor_codes_codigo_ativo_idx").on(t.codigo, t.ativo),
]);

// Senha de pareamento de uso único, hash no banco; nunca se guarda o código
// em texto. O admin pareia o MONITOR e cada motorista pareia seu RECEIVER.
export const monitorPairCodes = pgTable("monitor_pair_codes", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(), // MONITOR | RECEIVER
  motoristaId: integer("motorista_id").references(() => motoristas.id, { onDelete: "cascade" }),
  codigoHash: text("codigo_hash").notNull().unique(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  usadoEm: timestamp("usado_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("monitor_pair_codes_expira_em_idx").on(t.expiraEm)]);

// A senha permanente fica no Android Keystore; aqui só o SHA-256. Tokens FCM
// são credenciais de entrega e NUNCA aparecem em respostas para o navegador.
export const monitorDevices = pgTable("monitor_devices", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(), // MONITOR | RECEIVER
  motoristaId: integer("motorista_id").references(() => motoristas.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  fcmToken: text("fcm_token"),
  nome: text("nome").default("").notNull(),
  ativo: integer("ativo").default(1).notNull(),
  ultimoContatoEm: timestamp("ultimo_contato_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("monitor_devices_tipo_ativo_idx").on(t.tipo, t.ativo),
  index("monitor_devices_motorista_idx").on(t.motoristaId),
]);

// Não armazena remetente nem texto do WhatsApp: só códigos reconhecidos e
// evento único por aparelho, para impedir reenvio duplicado pela API.
export const monitorMessages = pgTable("monitor_messages", {
  id: serial("id").primaryKey(),
  monitorDeviceId: integer("monitor_device_id").notNull().references(() => monitorDevices.id),
  eventId: text("event_id").notNull(),
  origem: text("origem").notNull(), // com.whatsapp | com.whatsapp.w4b
  codigos: jsonb("codigos").$type<string[]>().notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("monitor_messages_device_event_unique").on(t.monitorDeviceId, t.eventId),
  index("monitor_messages_criado_em_idx").on(t.criadoEm),
]);

export const monitorDeliveries = pgTable("monitor_deliveries", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => monitorMessages.id),
  motoristaId: integer("motorista_id").notNull().references(() => motoristas.id, { onDelete: "cascade" }),
  deviceId: integer("device_id").notNull().references(() => monitorDevices.id),
  codigo: text("codigo").notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING | ACCEPTED | FAILED
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("monitor_deliveries_unique").on(t.messageId, t.deviceId, t.codigo),
  index("monitor_deliveries_motorista_data_idx").on(t.motoristaId, t.criadoEm),
]);

