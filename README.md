# CopaLinks

Monitoramento da **fila de ponto da Copadubo** para motoristas do Porto de
Paranaguá. O app lê o quadro de pontos a cada **5 segundos**, mostra a posição
do seu número na fila e **avisa no celular quando ele é chamado**.

## O que tem dentro

| Área | O que faz |
|---|---|
| **Início** | ponto monitorado ao vivo, último escalado e contadores das 6 tabelas (TRUCK e CAVALO/C nos Livros A, B e M) |
| **Cadastrar ponto** | tipo + livro + número, com ativação de notificações |
| **Notificações** | Web Push (VAPID) quando o ponto é chamado, sai da tabela ou chega perto da vez |
| **Tempo em Paranaguá** | previsão e estação do porto (APPA/SIMPORT), 15 dias, rolagem lateral |
| **Cálculo de Frete** | lê a foto do ticket (Quant × Valor) e mostra o ganho do motorista |
| **Contatos** | WhatsApp do plantão, encarregado, Fospar, SEV e robôs |
| **Chat dos motoristas** | recados sobre o trabalho, digitados livremente; cada mensagem nova chega como notificação (nome + texto), mesmo com o app fechado |
| **Serviços** | links: login do aplicativo, tela de caminhões, APPA, SINPRAPAR |
| **Configurações de API** (`/admin`) | API Keys cifradas, testes de conexão e auditoria |

## Tecnologia

- **Next.js (App Router) + TypeScript + Tailwind CSS**
- **Layout na largura do aparelho**: as telas do motorista usam toda a largura
  em **dp** configurada no celular (classe `.largura-aparelho` em
  `globals.css`), em vez de uma coluna fixa de 360 px. A viewport já é
  `device-width`; só a partir de 768 px (tablet/desktop) a coluna é
  centralizada com teto de 768 px.
- **PostgreSQL** com Drizzle ORM
- **Web Push** (`web-push`, VAPID) com Service Worker próprio
- **Leitura do site monitorado**: `intranet.copadubo.com.br/ponto/` (3 quadros,
  6 tabelas), com reserva via **Composio**
- Clima: **APPA/SIMPORT** + Open-Meteo, com reserva via Composio

## Motoristas e pontos

O app mostra a cada motorista somente **os pontos do próprio perfil** no cartão
e na lista "Seus pontos". A página inicial e as APIs de leitura, cadastro,
edição e remoção identificam o motorista por uma sessão do aparelho (cookie
`httpOnly`; apenas o hash do token fica no PostgreSQL). Perfis antigos salvos
no aparelho podem ser vinculados na primeira abertura após a atualização.
O mesmo número pode ser monitorado por motoristas diferentes. Os totais e o
"último escalado" do quadro oficial continuam compartilhados; os números
individuais de outros motoristas não são enviados pela API pessoal.

**Ordem da fila:** “Último Escalado” é o último ponto **já chamado** e não
ocupa posição na fila atual. A primeira linha destacada em vermelho no quadro
oficial é o número 1 (**NA VEZ**, zero na frente); a linha seguinte é o número 2
(**um na frente**), e assim por diante — mesmo se os códigos pularem números.
Por exemplo: último escalado **A183**, linha 1 **A184**, linha 2 **A187**.
Se o último escalado ainda aparecer acima do vermelho, ele é excluído da
contagem. A mesma regra vale para a leitura de reserva sem cores do Composio.

**Avisos do ponto:** NA VEZ significa que o número é o primeiro do quadro,
mas **ainda não saiu para o trabalho**. "Saiu para o trabalho" só é enviado
quando esse número se torna o Último Escalado ou desaparece das duas tabelas
(TRUCK/CAVALO) numa **leitura completa dos seis quadros**. Se faltar um livro,
um bloco ou a tabela estiver cortada, o monitor mantém o último estado sem
avisar uma saída falsa. Os avisos são enviados pelo `/api/cron` mesmo com o
app fechado (Supabase pg_cron a cada minuto), que aguarda o envio ao serviço
Web Push antes de responder; o Service Worker exibe o aviso sem aba aberta.
O envio ao serviço Push não garante, por si só, que o sistema operacional
exibiu a mensagem: o motorista precisa autorizar notificações no celular.

**"Atualizado há…" e ONLINE:** o contador mostra o horário da **última leitura
real** do quadro da Copadubo (campo `lidoEm` da amostra), não da última
tentativa. Se o site não responder, o horário não é renovado — o contador
continua subindo e o selo muda para OFFLINE. Dados reaproveitados do cache
(4 s) ou da reserva do Composio (até 1 min) mantêm a hora em que foram lidos.
ONLINE exige que a última tentativa tenha lido o site e que essa leitura tenha
no máximo 2 minutos. O app corrige a diferença entre o relógio do celular e o
do servidor (`servidorAgora`), para um relógio atrasado não travar o contador
em "0s". Teste: `tests/leitura-horario.test.ts` (banco `fila_push_test_*`).

Regressões unitárias: `./node_modules/.bin/tsx --test tests/fila.test.ts tests/service-worker.test.ts`.
O teste do cron/Push usa **somente** um PostgreSQL local descartável com
`DATABASE_URL=TEST_DATABASE_URL` e nome `fila_push_test_*` (ver
`tests/cron-push.test.ts`); nunca roda no banco de produção.

**Alerta individual do administrador:** em `/admin → Motoristas`, cada nome
tem **Enviar alerta** (em destaque para quem está "sem avisos"), com a
mensagem editável. O alerta aparece no app daquele motorista em **tela cheia,
sem botão de fechar**, na próxima abertura (ou em até 1 min com o app aberto),
e só fecha tocando em **Ativar notificações**: o servidor confere que a
inscrição Web Push daquele aparelho existe e é dele (`POST /api/motoristas/alerta`).
Se a permissão estiver bloqueada, o alerta ensina a liberar. Em aparelho sem
suporte a notificações (ex.: iPhone sem o app na Tela de Início) mostra como
instalar e permite "Fechar por agora", mas o alerta continua pendente e volta
na próxima abertura. O painel mostra "aguardando" ou "ativou em …", e permite
reenviar ou cancelar. Tabela `alertas_motorista` (criada pelo app); envios e
cancelamentos vão para a auditoria. Teste: `tests/alerta-admin.test.ts`.

**Chat — silenciar e figurinhas:** o sino ao lado do **X** no topo do chat
silencia **só as notificações do chat** para o motorista (todos os aparelhos
dele), inclusive os avisos de clima postados no chat; os avisos do ponto (NA
VEZ, SAIU, perto da vez, lista do grupo) continuam chegando. Fica na tabela
`chat_silenciados`, criada automaticamente pelo app. O botão 😀 ao lado do
campo abre **Emojis** (inserem no texto) e **Figurinhas** (enviam na hora).
Figurinha é uma mensagem de texto normal ("☕ Bom dia, motoristas!") que o chat
desenha grande; mensagens só com 1 a 3 emojis também aparecem grandes. Para
criar figurinhas, edite `FIGURINHAS` em `src/lib/figurinhas.ts`. Testes:
`tests/figurinhas.test.ts` e `tests/chat-silencio.test.ts`.

**Administrador:** em `/admin` há o card "Motoristas", com nome e pontos de
todos os cadastrados, situação/posição e aparelhos com avisos ativos. A rota
`/api/admin/motoristas` exige login admin e não é acessível por motoristas.
O chat é coletivo: mensagens que uma pessoa publica nele são visíveis para
as demais, independentemente dos pontos particulares.

**Notificações do chat (Web Push):** toda mensagem gravada no chat — escrita
por um motorista ou postada por um agente do servidor (ex.: "🌦️ Clima no
Porto", gerado via Composio no `/api/cron`) — dispara um Web Push com o
**nome de quem enviou** no título e o **texto da mensagem** no corpo
(`src/lib/chat-push.ts`). O envio é aguardado pelo `POST /api/chat` antes de
responder, por isso funciona na Vercel com o app fechado; o Service Worker
exibe o aviso e, ao tocar, abre o app direto no chat (`/?chat=1`, ou
`postMessage` "abrir-chat" quando a aba já está aberta). Quem escreveu não
recebe o próprio aviso; a tag `CHAT_<id>` impede aviso repetido. Exige as
notificações ativadas no aparelho (botão **Ativar notificações**).
Teste: `TEST_DATABASE_URL=... tsx --test tests/chat-push.test.ts` (banco
`fila_push_test_*`, com serviço Push falso local).

## Filtro do grupo SEM APK (pelo servidor)

Um site/PWA não consegue ler notificações nem mensagens de outros apps. Para o
filtro do grupo funcionar **sem o app Android**, um número de WhatsApp que
participa do grupo fica conectado a um serviço de WhatsApp Web (recomendado:
**Green-API**; também aceitos Z-API, Evolution API, WAHA, Whapi ou uma ponte
própria). A cada mensagem, o serviço chama `POST /api/whatsapp/webhook`:

1. o segredo é conferido (Authorization `Bearer`/`Basic`, `X-Webhook-Token`
   ou `?token=`); sem ele → 401;
2. só passa o grupo `INFO. OP PORTO / FOSPAR **` (nome exato, ou o ID do grupo
   aprendido na 1ª mensagem; `WHATSAPP_GRUPO_ID` fixa o ID e torna a regra
   estrita). Conversas privadas e outros grupos são **descartados na hora**,
   sem gravar nada;
3. a lista vai para o **mesmo** `processarMensagemGrupo` do monitor Android:
   mesmo filtro, mesmos avisos ("🔔 Ponto na vez nº A014", "⚠️ Ponto pulado nº
   A137"), mesma trava de 1 aviso por dia por ponto, Web Push só ao dono.

Configuração: `/monitor` (admin) → card **Filtro do grupo sem APK** → **Gerar
endereço** (URL + token, mostrados uma vez; no banco fica só o hash) → colar no
serviço. O card mostra quando o serviço falou com o CopaLinks, a última
mensagem do grupo e as listas processadas. "Revogar" o aparelho *WhatsApp sem
APK (servidor)* em Aparelhos pareados, ou **Desligar** no card, interrompe a
entrada. **Use um número dedicado:** é uma conexão não oficial do WhatsApp
(risco de bloqueio do número) e o serviço escolhido recebe as mensagens dessa
conta. No plano gratuito do Green-API cabem até 3 conversas por mês — um chip
que só participa deste grupo fica dentro do limite.
Testes: `tests/whatsapp-webhook.test.ts`.

## Monitor WhatsApp → Firebase (Android)

O recurso novo **não substitui** a fila, o chat ou o Web Push já existentes.
Cada motorista cadastra em **Sobre → Monitor WhatsApp** os códigos A/B/M que deseja
acompanhar (lista `monitor_codes`, independente dos pontos da fila). No `/admin →
Monitor WhatsApp` (`/monitor`), o administrador gera um código temporário para
parear o Android monitor. Cada motorista gera um código diferente para parear
seu próprio Android receptor.

Com o usuário concedendo **Acesso a notificações** nas configurações do Android,
o `NotificationListenerService` aceita apenas `com.whatsapp` / `com.whatsapp.w4b`
**do grupo** `INFO. OP PORTO / FOSPAR **`. Outros grupos, conversas privadas
e notificações sem confirmação do grupo são ignorados. Ele lê apenas a mensagem
mais recente, extrai códigos localmente e envia **só os códigos e o hash do
grupo, sem conversa, título nem remetente** para `/api/monitor/messages`.
A API rejeita hash de outro grupo e reconfirma a correspondência em PostgreSQL,
grava somente metadados/idempotência e usa Firebase Cloud Messaging para avisar
**apenas os receptores pareados dos motoristas inscritos naquele código**.
Receber FCM exige o app Android nativo; o PWA mantém os avisos da fila via
Web Push/VAPID. Não há envio para WhatsApp nem acesso às conversas.

Estrutura: `src/app/api/monitor/messages`, `src/app/api/devices/register`,
`src/app/api/codes`, `src/app/api/notifications`, `src/lib/supabase.ts`
(adaptador do Drizzle), `src/lib/auth.ts`, `src/lib/matcher.ts`,
`src/lib/firebase.ts`, `supabase/migrations/monitor.sql` e o projeto
`android/MonitorApp/`. Consulte [o guia Android](./android/MonitorApp/README.md)
para criar o projeto Firebase, instalar `google-services.json` **fora do Git**,
configurar `FIREBASE_SERVICE_ACCOUNT_JSON` **só na Vercel** e parear os aparelhos.
Até isso acontecer, o backend mostra "Firebase não configurado" e não afirma
que notificou ninguém. FCM aceito não é confirmação de que o Android exibiu o
aviso. O usuário pode revogar o acesso a notificações no Android quando quiser.

## Imagem do topo personalizável

A tela inicial mostra uma foto de caminhão atrás do logo e da saudação
(`public/images/caminhao-padrao.webp`). A foto é mostrada **nítida, sem véu
azul** (era assim antes e sujava o céu): a máscara `.imagem-nitida`
(`src/app/globals.css`) deixa 0–95% exatamente como o arquivo original e só os
últimos **5% da base** se dissolvem no `#002b6b` do app, para não ficar linha
dura. Os controles sobre a foto — compartilhar, previsão do tempo e trocar a
imagem — são discretos de propósito: ícone pequeno (17 px), ganho de toque de
44 px, fundo `bg-black/20` e borda `border-white/10`, sem caixa azul pesada.
**Nada de voltar a cobrir a foto com degradê no topo, na esquerda ou com
brilho** — `tests/layout-largura.test.ts` trava isso. Em **Personalizar imagem** o motorista
tira uma foto ou escolhe da galeria; o celular reduz a foto e envia para
`POST /api/motoristas/banner`. O servidor (`src/lib/banner.ts`) valida tipo
(JPG/PNG/WebP), tamanho (até 8 MB) e se é imagem de verdade, e manda para o
**Nano Banana pelo Composio** (`GEMINI_GENERATE_IMAGE`) com um prompt que
transforma a foto em imagem cinematográfica **preservando o caminhão** (sem
textos, logos ou placas inventadas). Os campos da ferramenta são lidos na hora;
a foto fica num endereço secreto por no máximo 10 min só para o gerador baixar.
Se o gerador não estiver disponível, aplica um tratamento local (cor,
contraste, nitidez, luz de cinema). Resultado: WebP 1536×1024 com recorte
inteligente, salvo em `banners_motorista` — cada motorista só vê o próprio
(`/api/motoristas/banner/imagem`, sessão httpOnly). Limite de 6 trocas por
hora. Teste: `tests/banner.test.ts`.

## Regras de segurança do Porto

Quando o ponto de um motorista **sai para o trabalho** (SAIU depois de ter
aparecido no quadro), o `/api/cron` manda as **11 regras de segurança**
(faróis, sinalização, lona, velocidade, vias livres, local proibido, fumar,
escada lateral, beirada do costado, guindaste, segurança sempre), uma de cada
vez, só para os aparelhos dele: a 1ª um minuto depois do aviso de saída e as
seguintes a cada 30 min (≈5 h de serviço). Saídas com mais de 6 h não recebem.
Texto e tempos em `src/lib/regras-seguranca.ts`; controle na tabela
`regras_envios`. Não altera a fila. Teste: `tests/regras-seguranca.test.ts`.

## Navios de fertilizantes (Paranaguá e Antonina)

O `/api/cron` (a cada minuto; no máximo uma leitura a cada 5 min) lê o
**line-up da APPA** (berço, mercadoria, toneladas, chegada, ETA/ETB,
atracação, saldo) e as **manobras previstas do SINPRAPAR** (hora, calado,
confirmada ou não) — `src/lib/navios.ts`. Para navios de **fertilizantes**
(ureia, MAP, DAP, cloreto de potássio, sulfato de amônio, nitratos, NPK,
superfosfatos, rocha fosfática…) o app avisa, uma vez cada:
1. **programado para atracar** (berço definido);
2. **atracação confirmada** pela praticagem (manobra EA/AT confirmada);
3. **atracou**.

O aviso é escrito pela IA (Gemini pelo Composio) em tom humano, com a análise
da **maré** (Open-Meteo Marine, referência — não é a tábua oficial) e o
calado; sem IA, usa um texto pronto. Sai no chat como **🚢 Navios no Porto** e
por Web Push (quem silenciou o chat não recebe) — `src/lib/navios-aviso.ts`,
tabela `navios_avisos`. Na 1ª execução só registra o que já existe.

O **Assistente IA** do chat responde sobre qualquer navio (line-up, manobras e
maré entram no contexto quando a pergunta fala de navio, berço, carga,
fertilizante, maré…). Para posição/rota, pesquisa na web pelo Composio
(`COMPOSIO_SEARCH_WEB`: VesselFinder, MarineTraffic, Google). `GET /api/navios`
devolve os navios de fertilizantes e as próximas marés (dados públicos).
Testes: `tests/navios.test.ts` e `tests/navios-aviso.test.ts`.

## Filtro automático do grupo (PONTOS NA VEZ / PULADAS)

O Monitor Android lê as **notificações** que o WhatsApp publica no aparelho
(`NotificationListenerService`), só do grupo **`INFO. OP PORTO / FOSPAR **`**.
Quando a mensagem mais recente traz **PONTOS NA VEZ** ou **... PULADAS**, o
texto dela é enviado a `POST /api/monitor/grupo` (autenticado pelo segredo do
Monitor pareado). O servidor (`src/lib/grupo-filtro.ts` e `src/lib/grupo-aviso.ts`):

1. separa os códigos de cada lista (`A014`, `B010`…: letra + **3 dígitos**);
2. compara o **código completo** com os pontos cadastrados de cada motorista
   (`pontos` e `monitor_codes`), sem confundir A014/A140, A019/A190 ou A001/A014;
3. avisa **só o dono**, pelo mesmo Web Push do app, mesmo com o app fechado:
   `🔔 Ponto na vez nº A014` ou `⚠️ Ponto pulado nº A137`.

O texto não é gravado (no banco fica só "NA VEZ: 8 códigos") e o remetente
nunca é enviado. Mensagens comuns do grupo nem saem do celular. O mesmo aviso
(lista + código + motorista) sai no máximo **uma vez por dia**, mesmo que o
grupo repita a lista. Não depende do Firebase. No `/monitor` (admin), o card
**Filtro automático do grupo** simula uma mensagem colada (ou envia os avisos).

Limitações do Android (o monitor lê notificações; não acessa o WhatsApp):
- WhatsApp com notificações **ativadas** no aparelho monitor: funciona.
- Notificações do WhatsApp **desativadas**: não há o que capturar.
- Grupo **silenciado**: funciona enquanto o WhatsApp continuar publicando a
  notificação no Android.
- **Celular bloqueado**: o serviço continua recebendo o que o sistema
  publica, conforme o conteúdo que o WhatsApp coloca na notificação.

Mantenha as notificações do WhatsApp habilitadas no aparelho monitor. Testes:
`tests/grupo-filtro.test.ts` (filtro) e `tests/grupo-aviso.test.ts` (ponta a
ponta, banco `fila_push_test_*`); no Android, `GroupMessageFilterTest`.

## Rodar localmente

```bash
cp .env.example .env        # preencha DATABASE_URL
npm install
npx drizzle-kit push        # cria as tabelas
npm run dev
```

## Publicar na Vercel

O projeto oficial é **`copa-links`** (https://copa-links.vercel.app), no time
**`copalink-projects`**, conectado à branch `main` de
**[Jonas1401/copa](https://github.com/Jonas1401/copa)**. A raiz do repositório
é a raiz da aplicação Next.js; o PostgreSQL está no **Supabase**. Cada push na
branch `main` aciona um novo deploy. O domínio e as variáveis são do projeto
`copa-links`, não do projeto de teste `copa`.

Para recriar do zero, consulte [DEPLOY.md](./DEPLOY.md) e [SUPABASE.md](./SUPABASE.md).
Não comite `.env` nem cole a `DATABASE_URL` no chat.

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `DATABASE_URL` | sim | conexão PostgreSQL do Supabase (servidor, via Drizzle) |
| `SITE_URL` | recomendada | endereço público fixo para links de compartilhar |
| `CRON_SECRET` | recomendada | autenticação do Cron diário da Vercel |
| `SUPABASE_CRON_SECRET` | se usar pg_cron | chave separada do cron de 1 minuto; o mesmo valor fica no Supabase Vault |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | sim, para Monitor WhatsApp nativo | JSON privado de conta de serviço Firebase, só na Vercel; nunca no Android/GitHub |
| `SECRETS_MASTER_KEY` | não | chave mestra das API Keys do painel |
| `ADMIN_SETUP_CODE` | só no primeiro cadastro | código para criar o primeiro administrador |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | não | chaves de notificação (o app gera e guarda no banco se ausentes) |

Segredos opcionais (Composio, WhatsApp, IA) podem ser cadastrados no `/admin`:
ficam **cifrados no banco** e nunca são enviados ao navegador. As chaves do
Supabase REST não são usadas pelo código do app; o banco é acessado diretamente
por `DATABASE_URL`.

O plano gratuito da Vercel executa Cron **no máximo uma vez ao dia**. Para
varrer a fila também com o app fechado sem fazer upgrade, usamos
**Supabase pg_cron + pg_net**, que chama `/api/cron` com a chave guardada no
Supabase Vault. Consulte [GITHUB_VERCEL.md](./GITHUB_VERCEL.md).

## Trocar a logo

Coloque a arte original (pode ser com **fundo preto**) e rode:

```bash
node scripts/gerar-logo.mjs caminho/da/logo.png
# ou direto de um link: node scripts/gerar-logo.mjs https://raw.githubusercontent.com/.../logo.png
```

O script tira o fundo preto (sem deixar borda escura) e gera, com os mesmos
nomes que o app já usa: a logo transparente do cabeçalho e das boas-vindas,
todos os ícones (favicon, app instalado, iPhone, Android maskable, notificação),
a imagem de compartilhamento `compartilhar.jpg` e as medidas em `src/lib/logo.ts`.

## Trocar a foto de fundo

```bash
node scripts/gerar-fundo.mjs caminho/da/foto.jpg
```

Gera `public/images/fundo-app.webp` (otimizada e na orientação certa) e atualiza
`src/lib/fundo.ts`. A foto aparece no início, nas boas-vindas, no frete e nos
contatos, sempre com a camada escura por cima para o texto continuar legível.

## Estrutura

```
src/app        rotas e páginas (/, /tempo, /frete, /contatos, /admin, /api)
src/components telas (início, tempo, frete, chat, admin)
src/lib        monitoramento do ponto, push, clima, integrações
scripts        exportar/importar o banco
```


## Push em segundo plano
A réplica usa servidor + VAPID + Service Worker. Para notificações com a interface fechada, configure o `/api/cron` para rodar aproximadamente a cada minuto e defina `CRON_SECRET`. Consulte `GITHUB_VERCEL.md`.
