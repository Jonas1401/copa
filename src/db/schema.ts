import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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

// Avisos de navios de fertilizantes já enviados (cada evento sai uma vez só).
// chave: "P:<programação>:<berço>" programado · "M:<programação>:<data hora>"
// manobra confirmada · "A:<programação>" atracado · "S:<programação>" saiu ·
// "E:<programação>:<ETB>" previsão de atracação notificada (a mais nova serve
// de referência para medir a próxima mudança de ETB).
export const naviosAvisos = pgTable("navios_avisos", {
  chave: text("chave").primaryKey(),
  navio: text("navio").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Mudanças na previsão do tempo avisadas pelo RADAR (src/lib/clima-monitor.ts):
// uma linha por mudança publicada no chat. A assinatura ("<data>:<chave>:<de>><para>")
// é única, então a mesma mudança não é avisada duas vezes no mesmo dia, e o
// histórico serve de limite de avisos por hora (retenção: 30 dias).
export const climaMudancas = pgTable("clima_mudancas", {
  id: serial("id").primaryKey(),
  assinatura: text("assinatura").notNull().unique(),
  resumo: text("resumo").notNull(),
  grave: integer("grave").default(0).notNull(),
  mensagemId: integer("mensagem_id"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("clima_mudancas_criado_em_idx").on(t.criadoEm)]);

// Regras de segurança do Porto enviadas depois que o ponto sai para o
// trabalho. Uma linha por saída (motorista + horário da saída).
export const regrasEnvios = pgTable("regras_envios", {
  chave: text("chave").primaryKey(), // "<motoristaId>:<saidaEm ISO>"
  motoristaId: integer("motorista_id").notNull().references(() => motoristas.id, { onDelete: "cascade" }),
  enviadas: integer("enviadas").default(0).notNull(),
  ultimoEnvioEm: timestamp("ultimo_envio_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Imagem do topo da tela inicial escolhida por cada motorista (já tratada).
// Só o próprio motorista vê a dele. imagem = WebP em base64.
export const bannersMotorista = pgTable("banners_motorista", {
  motoristaId: integer("motorista_id").primaryKey().references(() => motoristas.id, { onDelete: "cascade" }),
  imagem: text("imagem").notNull(),
  via: text("via").notNull(), // ia | local
  versao: text("versao").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Foto original guardada por poucos minutos para o gerador de imagem buscar.
export const bannerFontes = pgTable("banner_fontes", {
  token: text("token").primaryKey(),
  imagem: text("imagem").notNull(), // JPEG em base64
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
});

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
  tipo: text("tipo").default("texto").notNull(), // texto | audio | imagem | arquivo
  mediaNome: text("media_nome"),
  mediaTipo: text("media_tipo"),
  // Base64 compacto para anexos pequenos do chat; a listagem nunca devolve este campo.
  mediaDados: text("media_dados"),
  duracaoSegundos: integer("duracao_segundos"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

// Conversa privada de cada motorista com o assistente de IA (navios, caminhão
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



/* ========================== INTERNET / eSIM (admin piloto) ============== */

/**
 * Modelo privado de Internet/eSIM. A página e as rotas de consulta são admin-only
 * durante o piloto; `esim_users.motorista_id` liga o cliente ao perfil CopaLinks.
 */
export const esimUsers = pgTable("esim_users", {
  id: serial("id").primaryKey(),
  motoristaId: integer("motorista_id").references(() => motoristas.id, { onDelete: "set null" }),
  nome: text("name").notNull(),
  email: text("email"),
  telefone: text("phone"),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("esim_users_motorista_id_unique").on(t.motoristaId), index("esim_users_email_idx").on(t.email)]).enableRLS();

export const esimPlans = pgTable("esim_plans", {
  id: serial("id").primaryKey(),
  providerPackageId: text("provider_package_id").notNull().unique(),
  providerProductId: text("provider_product_id"),
  providerProductCode: text("provider_product_code"),
  providerProductName: text("provider_product_name").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  wholesalePrice: numeric("wholesale_price", { precision: 19, scale: 6 }).notNull(),
  retailReferencePrice: numeric("retail_reference_price", { precision: 19, scale: 6 }),
  currency: text("currency").notNull().default("USD"),
  dataAmount: numeric("data_amount", { precision: 19, scale: 6 }),
  dataUnit: text("data_unit"),
  durationDays: integer("duration_days"),
  source: text("source").notNull().default("nexa"), // nexa | test-fixture
  available: boolean("available").notNull().default(false),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_plans_active_idx").on(t.active, t.available)]).enableRLS();

export const esimOrders = pgTable("esim_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => esimUsers.id),
  planId: integer("plan_id").notNull().references(() => esimPlans.id),
  status: text("status").notNull().default("AWAITING_PAYMENT"),
  currency: text("currency").notNull().default("USD"),
  costAmount: numeric("cost_amount", { precision: 19, scale: 6 }).notNull(),
  amount: numeric("amount", { precision: 19, scale: 2 }).notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  providerOrderCode: text("provider_order_code").unique(),
  providerCallbackUrl: text("provider_callback_url"),
  providerStatusCode: integer("provider_status_code"),
  errorCode: text("error_code"),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_orders_user_idx").on(t.userId, t.criadoEm), index("esim_orders_status_idx").on(t.status)]).enableRLS();

export const esimPayments = pgTable("esim_payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => esimOrders.id, { onDelete: "cascade" }).unique(),
  gateway: text("gateway").notNull().default("unconfigured"),
  gatewayPaymentId: text("gateway_payment_id").unique(),
  method: text("method"), // pix | card; preenchido pelo gateway integrado
  status: text("status").notNull().default("PENDING"),
  amount: numeric("amount", { precision: 19, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_payments_status_idx").on(t.status)]).enableRLS();

export const esims = pgTable("esims", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => esimUsers.id),
  orderId: integer("order_id").notNull().references(() => esimOrders.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => esimPlans.id),
  iccid: text("iccid").unique(),
  status: text("status").notNull().default("PENDING"),
  providerStatus: text("provider_status"),
  qrCode: text("qr_code"),
  qrUrl: text("qr_url"),
  activationCode: text("activation_code"), // só salvar se a API devolver esse campo
  installationUrl: text("installation_url"),
  smDp: text("smdp"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  totalDataAmount: numeric("total_data_amount", { precision: 19, scale: 6 }),
  totalDataUnit: text("total_data_unit"),
  source: text("source").notNull().default("nexa"),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esims_user_idx").on(t.userId, t.criadoEm), index("esims_order_idx").on(t.orderId)]).enableRLS();

export const esimUsage = pgTable("esim_usage", {
  id: serial("id").primaryKey(),
  esimId: integer("esim_id").notNull().references(() => esims.id, { onDelete: "cascade" }),
  usedAmount: numeric("used_amount", { precision: 19, scale: 6 }),
  remainingAmount: numeric("remaining_amount", { precision: 19, scale: 6 }),
  dataUnit: text("data_unit"),
  providerPayloadHash: text("provider_payload_hash"),
  status: text("status").notNull(),
  note: text("note").notNull().default(""),
  consultadoEm: timestamp("queried_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_usage_esim_idx").on(t.esimId, t.consultadoEm)]).enableRLS();

export const esimTopups = pgTable("esim_topups", {
  id: serial("id").primaryKey(),
  esimId: integer("esim_id").notNull().references(() => esims.id, { onDelete: "cascade" }),
  planId: integer("plan_id").references(() => esimPlans.id),
  paymentId: integer("payment_id").references(() => esimPayments.id),
  providerTopupId: text("provider_topup_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  amount: numeric("amount", { precision: 19, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("PENDING"),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_topups_esim_idx").on(t.esimId, t.criadoEm)]).enableRLS();

/** Recibos sem corpo nos endpoints de leitura: códigos QR nunca vão para a UI de webhooks. */
export const esimWebhookEvents = pgTable("esim_webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // nexaesim | payment-gateway
  eventHash: text("event_hash").notNull(),
  providerEventId: text("provider_event_id"),
  providerOrderCode: text("provider_order_code"),
  eventType: text("event_type"),
  status: text("status").notNull().default("RECEIVED"),
  result: text("result").notNull().default(""),
  // Só callbacks NexaEsim verificados sem orderCode/pagamento confirmado ficam
  // nesta coluna para reconciliação posterior; removido quando processado.
  pendingPayload: jsonb("pending_payload"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [
  unique("esim_webhook_events_provider_hash_unique").on(t.provider, t.eventHash),
  unique("esim_webhook_events_provider_event_unique").on(t.provider, t.providerEventId),
  index("esim_webhook_events_status_idx").on(t.status, t.receivedAt),
]).enableRLS();

export const esimApiErrors = pgTable("esim_api_errors", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull(),
  operation: text("operation").notNull(),
  httpStatus: integer("http_status"),
  providerErrorCode: text("provider_error_code"),
  message: text("message").notNull(),
  criadoEm: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("esim_api_errors_created_idx").on(t.criadoEm)]).enableRLS();

export const esimSettings = pgTable("esim_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  atualizadoEm: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
