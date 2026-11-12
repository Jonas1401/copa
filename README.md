# CopaLinks

Monitoramento da **fila de ponto da Copadubo** para motoristas do Porto de
Paranaguá. O app lê o quadro de pontos a cada **5 segundos**, mostra a posição
do seu número na fila e **avisa no celular quando ele é chamado**.

## O que tem dentro

| Área | O que faz |
|---|---|
| **Início** | ponto monitorado ao vivo, último escalado e contadores da fila (TRUCK e CAVALO/C), lidos na aba **Fila** do Portal do Motorista — o Livro A e o livro de cada ponto cadastrado (B, M); ao arrastar para um ponto de outro livro, os quadros mostram a fila desse livro |
| **Cadastrar ponto** | tipo + livro + número, com ativação de notificações |
| **Notificações** | Web Push (VAPID) quando o ponto é chamado, sai da tabela ou chega perto da vez |
| **Tempo em Paranaguá** | previsão e estação do porto (APPA/SIMPORT), 15 dias, rolagem lateral; sem boletins ou alertas automáticos no chat; leituras disponíveis para a IA responder perguntas |
| **Cálculo de Frete** | lê a foto do ticket (Quant × Valor) e mostra o ganho do motorista |
| **Contatos** | WhatsApp do plantão, encarregado, Fospar, SEV e robôs |
| **Chat dos motoristas** | recados sobre o trabalho, digitados livremente, com **áudio** e anexos; **figurinhas com imagem** em categorias (Caminhões, Motoristas, Porto e CopaLinks), grade de 4 por linha, publicadas pelo admin; **curtidas com emoji** nas mensagens (toque duplo ou botão 😀 na bolha, com lista de quem curtiu); o recado de voz toca em **1x, 1,5x ou 2x** (etiqueta de velocidade no player); o servidor posta apenas avisos de **navios/manobras**, com **um navio por mensagem e notificação**, lidos por HTTP direto com Composio de reserva; mensagens dos motoristas continuam funcionando |
| **Serviços** | login do aplicativo, **Saldo de Ganhos** (viagens, valor bruto e comissão da semana, lidos na aba **Ticket** do portal), cálculo de frete e contatos operacionais |
| **Divulgação** (`/divulgacao`) | página pública de instalação: o que o app faz, passo a passo por aparelho (Android, iPhone, navegador dentro do WhatsApp), QR Code do link, prévia da mensagem e as artes para status |
| **Portal do motorista** | o motorista digita no próprio celular (menu ⋮) o **CPF e a senha do `portal.copadubo.com.br`**; o servidor olha o **Status do ponto** dele de minuto em minuto e avisa quando o ponto for **ESCALADO**, entrar **EM DISPENSA** ou voltar a **ATIVO** — é o portal que decide a saída (ver abaixo) |
| **Configurações de API** (`/admin`) | API Keys cifradas, testes de conexão, auditoria, o cartão **Radar da previsão** (monitoramento do tempo, painel da APPA com fallback automático e "método de leitura" usado, exclusivo do administrador) e o cartão **Divulgação do app** (QR Code, mensagem pronta e artes da campanha) |

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
- Clima: **APPA/SIMPORT** + Open-Meteo, com reserva via Composio; o **Radar da
  previsão** monitora o tempo o dia todo (painel da APPA lido com **fallback
  automático**: API/JSON → HTML → navegador headless → OCR → Composio)

## Motoristas e pontos

O app mostra a cada motorista somente **os pontos do próprio perfil** no cartão
e na lista "Seus pontos". A página inicial e as APIs de leitura, cadastro,
edição e remoção identificam o motorista por uma sessão do aparelho (cookie
`httpOnly`; apenas o hash do token fica no PostgreSQL). Perfis antigos salvos
no aparelho podem ser vinculados na primeira abertura após a atualização.
O mesmo número pode ser monitorado por motoristas diferentes. Os totais e o
"último escalado" do quadro oficial continuam compartilhados; os números
individuais de outros motoristas não são enviados pela API pessoal.

> **De onde vem a fila (desde 11/11/2026):** da aba **“Fila”** do Portal do
> Motorista — ver [A fila vem da aba “Fila” do portal](#a-fila-vem-da-aba-fila-do-portal).
> O quadro público da intranet foi desligado pela Copadubo em 10/11/2026. Nessa
> tela não há linha vermelha: o **SEQ 1** de cada quadro é quem está **NA VEZ**
> e o “Último ponto escalado” vem escrito no topo do quadro. O que os três
> parágrafos abaixo dizem sobre linhas vermelhas, “seis quadros”, cache de 4 s e
> Composio vale só com `FONTE_FILA=quadro` (o quadro antigo, se ele voltar).

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
dele), inclusive os avisos de navios postados no chat; os avisos do ponto (NA
VEZ, SAIU, perto da vez, lista do grupo) continuam chegando. Fica na tabela
`chat_silenciados`, criada automaticamente pelo app. O botão 😀 ao lado do
campo abre **Emojis** (inserem no texto) e **Figurinhas** (enviam na hora).
Mensagens só com 1 a 3 emojis aparecem grandes. Para criar figurinhas de
recado (texto com emoji), edite `FIGURINHAS` em `src/lib/figurinhas.ts`. Testes:
`tests/figurinhas.test.ts` e `tests/chat-silencio.test.ts`.

**Chat — figurinhas com imagem (catálogo central):** dentro da aba
**Figurinhas**, as categorias **Caminhões, Motoristas, Porto e CopaLinks** —
mais **Recados** (as figurinhas de texto de sempre) — mostram uma **grade de 4
figurinhas por linha** (WebP/PNG com fundo transparente, estilo CopaLinks:
caminhões, motoristas, porto de Paranaguá e o dia a dia da estrada). Um toque
envia; a figurinha aparece **sem balão**, com fundo transparente, mantendo
autor e horário (com curtidas, apagar e o rodapé de sempre). O catálogo fica
no banco (`figurinha_categorias` + `figurinhas_catalogo`, imagens em base64):
todo motorista — app, PWA ou Android — recebe as mesmas figurinhas, e o
histórico guarda a própria cópia da imagem enviada (apagar do catálogo não
apaga as mensagens). No painel **/admin** (cartão **Figurinhas do chat**) o
administrador publica PNG/WebP/GIF (até 512 KB, validados pelos bytes do
arquivo) com pré-visualização, nome, categoria e ordem, além de ativar,
desativar, reordenar, excluir e criar categorias novas (pacotes futuros entram
sem mexer no código do chat) — tudo auditado. Rotas `/api/figurinhas` (lista),
`/api/figurinhas/:id/imagem` (imagem) e `/api/admin/figurinhas*` (gestão). O
pacote atual de **42 figurinhas** (folha *CopaLinks Caminhões e Bordo*) é
semeado/versionado em `src/lib/figurinhas-pacote.ts`, gerado por
`node scripts/gerar-figurinhas.mjs` a partir de
`assets/figurinhas/copalinks-bordo.png` + `copalinks-bordo.json`. A migração
(`src/lib/figurinhas-migracao.ts`) troca o pacote antigo de 22 figurinhas pelo
atual uma única vez por banco, removendo apenas as imagens oficiais antigas
(pelo MD5 exato do base64) e preservando figurinhas publicadas pelo admin e o
histórico do chat. Testes: `tests/figurinhas-catalogo.test.ts`.

**Como a folha é recortada** (`scripts/lib/segmentar-folha.mjs`, lógica pura): as
caixas do JSON são só a *região de referência* de cada figurinha. O gerador
remove o fundo preto/preto-azulado da folha inteira, rotula os componentes
conexos e entrega cada desenho **completo**, mesmo quando ele ultrapassa a caixa
— era o que cortava a ponta da estrela do *Top!* e o dedo do *Gostei!*. Detalhes
soltos (vapor do café, riscos de movimento) acompanham a figurinha mais próxima.
Quando dois desenhos se encostam na folha e viram um blob só (caminhão +
motorista, motorista + *Obrigado!*), a divisão é feita por **distância
geodésica** — cada pixel vai para o lado cujo miolo está mais perto, medido por
dentro do desenho — com um alisamento de maioria na divisa; o corte acompanha o
contorno em vez de ser uma reta. Onde uma figurinha foi desenhada por cima da
outra, o campo `sobreposicao` do JSON registra o retoque fino. O gerador confere
a conservação dos pixels e falha se algum desenho sumir. Testes com imagens
sintéticas: `tests/figurinhas-recorte.test.ts`.

Saídas em `public/figurinhas/` (fora do Git): `png/<slug>.png` no tamanho
original, `<slug>.webp` 256×256 para o chat e um ZIP com tudo para download.

**Chat — curtidas com emoji:** qualquer mensagem recebida (texto, áudio, foto,
arquivo, figurinha ou aviso do sistema) pode ser curtida com 1 emoji, como no
WhatsApp. Vale o botão 😀 no rodapé da bolha (abre a escolha rápida de 8
emojis) ou o **toque duplo na bolha** (curte com 👍 na hora). Cada motorista
tem **uma curtida por mensagem**: repetir o mesmo emoji descurte, outro emoji
troca. A curtida aparece numa pílula grudada na borda de baixo da bolha e,
tocando nela, dá para ver **quem curtiu**. É silenciosa: não entra no chat
como mensagem nova e não dispara notificação — quem já está com o chat aberto
vê a pílula atualizar sozinha (a tela busca as curtidas junto com as mensagens
novas). Fica na tabela `chat_reacoes`, criada automaticamente pelo app
(`src/lib/chat-reacoes.ts` no servidor, `src/lib/reacoes.ts` na tela, rota
`/api/chat/reacoes`). Teste: `tests/chat-reacoes.test.ts`.

**Chat — velocidade dos áudios:** todo recado de voz tem a etiqueta de
velocidade ao lado de "Áudio": cada toque passa para a próxima
(**1x → 1,5x → 2x → 1x**, mostrada como "1,5x" e "2x" no player). A troca
vale na hora e **sem reiniciar o áudio** — quem já está ouvindo continua do
mesmo ponto, mais rápido, e a voz continua natural (o tom é preservado). A
escolha fica lembrada **no aparelho** (`localStorage`,
`src/lib/audio-velocidade.ts`), então os próximos áudios do chat já abrem na
velocidade escolhida; nada é gravado no servidor e a velocidade de uma pessoa
não muda a dos outros. Teste: `tests/audio-velocidade.test.ts`.

**Administrador:** em `/admin` há o card "Motoristas", com nome e pontos de
todos os cadastrados, situação/posição e aparelhos com avisos ativos. A rota
`/api/admin/motoristas` exige login admin e não é acessível por motoristas.
O chat é coletivo: mensagens que uma pessoa publica nele são visíveis para
as demais, independentemente dos pontos particulares.

**Cadastro de novos motoristas:** permanece funcionando sem mensagens automáticas
de boas-vindas no chat. O visual existente não foi alterado; a lista de agentes
automáticos do chat contém somente o monitor de navios.

**Notificações do chat (Web Push):** mensagens escritas por motoristas ou
postadas pelo monitor de navios (leitura HTTP direta, com Composio de reserva, no `/api/cron`) disparam Push (`src/lib/chat-push.ts`). Em geral, o
título mostra quem enviou e o corpo contém a mensagem; avisos de navios preservam o texto literal da fonte, sem corte de decimais no payload. O envio funciona com o app fechado: o Service Worker
exibe o aviso e, ao tocar, abre o app direto no chat (`/?chat=1`, ou
`postMessage` "abrir-chat" quando a aba já está aberta). Quem escreveu não
recebe o próprio aviso; a tag `CHAT_<id>` impede aviso repetido. Exige as
notificações ativadas no aparelho (botão **Ativar notificações**).
Teste: `TEST_DATABASE_URL=... tsx --test tests/chat-push.test.ts` (banco
`fila_push_test_*`, com serviço Push falso local); conteúdo da IA:
`tsx --test tests/boas-vindas-conteudo.test.ts`.


## Portal do motorista (`portal.copadubo.com.br`)

A **fila** — a posição, quem está na vez e o aviso de que a vez está chegando —
vem da aba **“Fila”** do portal, lida com a sessão de um motorista (ver
[A fila vem da aba “Fila” do portal](#a-fila-vem-da-aba-fila-do-portal)). Quem diz que o ponto **saiu
para o trabalho** é o **Status do Ponto** do mesmo portal — que só abre com login: o app
olha o **Status do Ponto** na conta de cada motorista **de minuto em minuto** e
avisa a troca de situação — **ESCALADO**, **EM DISPENSA** ou de volta a
**ATIVO** — com as informações que o Status mostra. Motorista que não cadastrou
o CPF/senha **não recebe aviso de saída**: a tela inicial mostra o chamado
“Aviso de saída desligado”, que abre o cadastro.

**Como o login funciona:** quem digita é o próprio motorista, uma única vez, no
celular (`menu ⋮ → Portal do motorista`). CPF e senha são enviados por HTTPS,
**cifrados com AES-256-GCM no banco** (mesma chave mestra do cofre de API Keys,
`src/lib/admin/segredos.ts`) e só o servidor decifra, para abrir a página. O
navegador nunca recebe de volta o CPF completo nem a senha — a tela e o `/admin`
mostram `***.***.789-01` e `••••1234`. Nada vai para log, auditoria, aviso ou
IA; `Apagar meus dados` (DELETE `/api/portal`) remove CPF, senha e leituras, e
excluir o cadastro do motorista apaga tudo o que é do portal dele.

> O ideal é `SECRETS_MASTER_KEY` definida no ambiente **antes** de os motoristas
> cadastrarem a senha: sem ela a chave mestra fica no próprio banco, ao lado
> dos dados cifrados. Atenção: criar ou trocar essa variável depois invalida o
> que já foi cifrado — as API Keys do painel e o CPF/senha de quem já cadastrou
> precisam ser digitados de novo.

**O caminho até a área do motorista** (`src/lib/portal-copadubo.ts`,
`src/lib/portal-sessao.ts`), conferido no site em 10/11/2026 sem fazer login:

1. `GET /moto/` — sem sessão o portal redireciona para a tela de login
   (`/login`) e já entrega o cookie da visita num `302`;
2. o leitor acha o formulário pelo campo de senha e envia o `POST` para o
   endereço e com os nomes de campo que a **própria tela** informa (hoje
   `email` e `password`). A caixa “Manter conectado” nunca é marcada;
3. só depois da resposta ao `POST` o login pode ser dado como aceito — e só se
   a área do motorista abrir. Voltou para a tela de login = **recusado**;
   `404`, `403`, `5xx` ou resposta vazia = **falha** (nem aceito, nem recusa).

Os redirecionamentos são seguidos um a um e **CPF/senha só saem para o
endereço do próprio portal**: formulário ou redirecionamento apontando para
outro site interrompe a leitura. Os cookies da sessão aberta ficam **cifrados
no banco** entre uma leitura e outra (é o que permite olhar o Status de minuto
em minuto sem um login por leitura — ver abaixo); com
`PORTAL_FONTE_SAIDA=quadro` eles ficam só na memória durante a visita (um login
por leitura, nada guardado).

> O defeito corrigido aqui: o app abria `/status.php`, que não existe (`404`),
> não encontrava campo de senha na página de erro e registrava “Login aceito”
> sem nunca enviar o CPF/senha. Toda saída virava “destino não confirmado”.

**Leitura genérica (não amarrada ao layout):** depois de entrar, cada tela vira
**seções e linhas** (`src/lib/portal-copadubo-parse.ts`): títulos viram seções,
cada célula de tabela vira uma coluna da linha, `div`/`p`/`li`/`br` quebram
linha. O leitor abre a página em que o login caiu, a tela de status
(`/moto/status`) e as abas que o **menu do portal** informa (**Ponto, Status,
Ticket, Fila**) — não sai testando endereços; se `/moto/status` não existir, a
tela é achada pela aba “Status”. E ele **só olha**: link ou botão de ação
(“Sair”, “Entrar em dispensa”, “Sair da dispensa”…) nunca é aberto.

**Um ponto por vez (“Trocar Ponto”).** A conta do motorista no portal pode ter
vários pontos, e “Status do Ponto” mostra só o que foi escolhido em “Trocar
Ponto” (uma lista com os pontos da conta e o botão “Confirmar”). O leitor faz
esse caminho: para cada ponto que o motorista cadastrou no app e que não está na
tela de Status, ele escolhe o ponto na lista e lê o Status de novo. Além do
login, essa escolha é a única coisa que ele envia ao portal — o endereço e o
nome do campo vêm do próprio formulário, e um formulário que fale de dispensa,
motivo, exclusão, saída ou senha (ou que tenha algo para digitar) nunca é
enviado. Com um ponto só, a escolha acontece uma vez por sessão e a leitura de
cada minuto continua sendo um pedido; com dois ou mais, cada leitura troca de
ponto (uns quatro pedidos por minuto). Se o ponto do app não estiver na lista da
conta, o diagnóstico diz quais pontos ela tem.

**Quando o app vai à conta do motorista** (o Status do portal é a fonte do
aviso de saída — o padrão):

| Quando | O que faz |
| --- | --- |
| **de minuto em minuto** (`/api/cron`; com o app aberto, também em segundo plano no `/api/estado`) | abre a tela de Status com a **sessão guardada** — um pedido só — e compara a situação de cada ponto do motorista com a que estava guardada |
| a situação **mudou** | abre também as abas do menu, na mesma sessão, para o aviso sair sem o menu e o rodapé do site |
| **com o app aberto, de 20 em 20 s** (depois da resposta do `/api/estado`) | reabre **só a aba “Fila”**, com a sessão guardada da conta que leu a fila por último — um pedido, para o app inteiro; nunca faz login nem mexe na sessão guardada ([a fila entre os ciclos](#com-o-app-aberto-a-fila-entre-os-ciclos)) |
| o portal **encerrou a sessão** | entra de novo **na leitura seguinte**. Se o portal continuar derrubando a sessão, o freio segura: depois de 2 logins em seguida, **um login automático a cada 10 min** por conta — e 10 min de espera depois de um login que não abriu a conta |
| o motorista toca em **Ler agora** | uma leitura na hora (até 6 por hora), sem o freio de logins |
| o administrador usa **Ler agora** / **Ler o portal agora** | uma leitura na hora, registrada na auditoria |

A sessão (os cookies do portal) fica **cifrada no banco, como a senha**
(`portal_motorista_acessos.sessao_cifrada`), e é apagada quando a senha é
trocada, recusada duas vezes ou removida. Cada conta é reservada no banco antes
da leitura (`proxima_leitura_em`, com `FOR UPDATE SKIP LOCKED`): o cron e o app
aberto nunca olham a mesma conta no mesmo minuto, e num mesmo servidor as idas
ao portal de um motorista são feitas uma de cada vez. Cada visita tem prazo
total de 22 s. A rodada do cron lê até 3 contas ao mesmo tempo durante 25 s; se
houver mais contas do que cabe em um minuto, quem espera há mais tempo vai
primeiro (e o intervalo real fica maior que 1 min).

O histórico (`portal_leituras`) não cresce uma linha por minuto: leitura igual
à anterior (só o “há N min” andou) atualiza a linha que já existe, e ficam no
máximo 300 linhas por motorista, por 7 dias.

`PORTAL_INTERVALO_MIN` (1 a 60; padrão 1) muda o intervalo sem mexer no código.

**Senha recusada:** na **segunda recusa seguida** o acesso é **pausado** (o app
para de tentar, para a conta do motorista não ser bloqueada), ele recebe um
aviso pedindo para cadastrar a senha de novo, a tela do portal mostra “Pausado”
e a tela inicial mostra “Aviso de saída parado”. Captcha e portal fora do ar
não contam como recusa.

**Leitura parada:** uma leitura só é boa quando a tela de Status mostra a
situação de um ponto **daquele motorista**. Na terceira leitura seguida sem ela
(portal fora do ar, captcha, tela diferente, número do ponto que não bate) o
motorista recebe “⚠️ Portal do motorista — Não consegui ler o Status do seu
ponto 3 vezes seguidas…”, e as tentativas passam a ser de 5 em 5 min até a
leitura voltar. Não existe aviso de reserva pelo quadro: sem o Status não há
aviso de saída.

**Diagnóstico (`/admin`):** o cartão **Portal do motorista** lista quem
cadastrou (CPF mascarado, 4 últimos da senha, ativo/pausado), a última leitura
(quando, quantas linhas, em quantos ms), o diagnóstico de cada tentativa (login
aceito ou recusado, captcha, portal fora, abas achadas no menu, situação lida) e
a página inteira em **Ver o que foi lido**. É por ali que se confere a leitura
sem pedir a senha de ninguém. **Remover acesso** apaga a senha daquele motorista
do banco.

O endereço do portal é trocável por `PORTAL_MOTORISTA_URL` (teste/homologação).
Em produção deixe **vazia**: o padrão é `https://portal.copadubo.com.br`. Se for
preenchida, é só a base do site — sem `/moto/status.php` no fim.


## A fila vem da aba “Fila” do portal

Em 10/11/2026 a Copadubo desligou o quadro público
(`intranet.copadubo.com.br/ponto/…`): a página passou a dizer que “a tela de
ativos mudou de endereço” e fica no Portal do Motorista. A fila do app passou a
ser a aba **“Fila”** do portal (a **Tela de Ativos**), que só abre com login.

**Como é lida.** Não há login a mais nem conta do app: a leitura pega carona na
olhada do Status (`src/lib/portal-monitor.ts`, `atualizarFilaDoPortal`). Quando
a conta de um motorista acabou de abrir e a fila guardada já tem um ciclo, a
**mesma sessão** abre a aba “Fila” — **um pedido a mais por ciclo, para o app
inteiro** (não um por motorista; a reserva em `portal_fila.proxima_leitura_em`
é atômica). Sem ninguém com o app aberto é só isso: o despertador de 1 minuto
abre a aba uma vez por rodada — cerca de 1.440 aberturas por dia, mais um toque
em “Livro B” ou “Livro M” por rodada para cada um desses livros que tiver ponto
cadastrado (ver **Livros**, abaixo). Depois de uma
tentativa que não serviu, outra conta pode tentar 20 s depois — 50 s se o livro
não tem nenhuma fila boa valendo (nunca foi lido, ou parou de vir): um motivo
que é da própria tela não se resolve batendo à porta de 20 em 20 s. Fora do ciclo, a aba só é aberta quando o motorista salva o
acesso ou toca em ler o portal, e no “Ler agora” do `/admin`. Se o portal
estiver lento e a conta levar mais de 12 s para abrir (25 s no “Ler agora”), a
aba fica para a próxima leitura — a abertura da aba pode levar até 14 s e não
pode estourar o tempo da função. É preciso **pelo menos um motorista com o
acesso ao portal cadastrado**; sem nenhum, não há de onde ler e o card mostra
“sem leitura da fila”.

### Com o app aberto: a fila entre os ciclos

Esperar o próximo ciclo de 1 minuto deixava o card até 65 s atrás do portal.
Com alguém com o app aberto, a aba “Fila” é relida também **entre** as olhadas
do Status (`atualizarFilaEntreCiclos`, chamada pelo `/api/estado` depois da
resposta — o app não espera por ela):

- **de 20 em 20 s**, um pedido só, para o app inteiro — a reserva no banco é a
  mesma da carona (agora de 18 s), então duas funções nunca abrem a aba juntas.
  O teto é **uma abertura a cada 18 s**: cerca de 3 por minuto com o app aberto
  (4.800 por dia se houvesse app aberto 24 h), em vez de 1 por minuto;
- com a **sessão guardada da conta que leu a fila por último**. Nunca faz login
  e não grava nada da sessão de volta: quem cuida da sessão continua sendo só a
  olhada do Status. Sem o endereço da aba já guardado nessa conta, não há pedido;
- **que livros**: o Livro A (os lidos sempre) e, dos livros que só são lidos
  por causa de um ponto cadastrado, os **pedidos** — o Livro B entra na
  releitura enquanto **alguém com ponto no Livro B está com o app aberto**; sem
  ninguém olhando, ele fica na carona, de minuto em minuto (ver **Livros**,
  abaixo). Todos os livros da vez vão na mesma visita: a aba e um toque em cada
  botão. Com alguém olhando A, B e M são 3 pedidos a cada 18 s, no máximo; com
  só o Livro A sendo olhado continua 1;
- só **continua uma leitura que está dando certo**: entram os livros que têm
  uma fila boa, ainda valendo e sem erro. Depois de qualquer falha num livro,
  quem volta a ler esse livro é a carona do Status — e **um livro que falha não
  segura os outros** (o Livro B sem leitura não tira do Livro A a releitura de
  20 em 20 s, nem o contrário);
- só usa uma **sessão assentada**: a conta precisa estar há **30 minutos sem
  login** no portal. É o freio dela: se as consultas a mais fizerem o portal
  encerrar a sessão de uma conta, ela entra de novo na olhada do Status (como
  sempre) e a leitura entre ciclos passa meia hora sem usá-la — no pior caso é
  um login a mais a cada meia hora, nunca um por minuto. Nesse intervalo nada é
  reservado nem registrado como erro: a fila segue na carona, de minuto em minuto;
- **desiste cedo**: 6 s para a leitura inteira (a carona tem 14 s), para um
  portal lento não segurar a sessão que a olhada do Status também usa;
- a fila nova passa pela varredura na hora: posição, “perto da vez” e “na vez”
  saem mais cedo.

`PORTAL_FILA_INTERVALO_S` muda o intervalo (10 a 60 segundos; padrão 20).
**`PORTAL_FILA_INTERVALO_S=0`** (ou `desligado`) é a chave de retorno: a fila
volta a ser lida só na carona do Status, no máximo uma vez a cada 45 s, como
era — use se o portal reclamar de tantas consultas. Um valor que não seja menor
que a espera do próprio Status (45 s no intervalo padrão) também desliga.

**O que fica guardado** (`portal_fila`, uma linha por livro): os pontos de cada
quadro, na ordem, e o último escalado — a fila geral, igual para todos — e o
número do motorista cuja conta abriu a tela (só para o `/admin`; some quando ele
apaga os dados do portal). Nada da conta de quem abriu: o aviso “Seu ponto (…)”
da tela não é guardado nem vai para o diagnóstico. Ao navegador vão só as
contagens e o último escalado, como antes.

**Livros: o de cada ponto cadastrado.** A Tela de Ativos mostra um livro por
vez, com três botões no alto: **Livro A · Livro B · Livro M**. O app lê os
**livros em uso** (`livrosEmUso`, em `src/lib/portal-fila.ts`): o **Livro A**,
sempre, e **o livro de cada ponto cadastrado no app** — quem cadastra o A032
faz o leitor ler o Livro A; o B032, tocar em “Livro B”; o M032, em “Livro M”. A
fila é geral (igual para todas as contas), então vale o ponto de qualquer
motorista, tenha ele o acesso ao portal ou não: quem abre a tela é a conta de
quem tem. Tirado o último ponto de um livro, ele deixa de ser lido.

- **O toque no botão** (`extrairToquesDeLivro`, em `src/lib/portal-fila-parse.ts`).
  O HTML de verdade nunca foi visto, então o botão é aceito nas formas em que um
  site de páginas inteiras costuma fazê-lo: link (`<a href>`), botão que leva a
  um endereço (`onclick="location.href='…'"`, `data-href`) e botão de formulário,
  GET ou POST (com os campos escondidos e o nome do botão, como o navegador
  manda). Sempre só o controle cujo texto é exatamente “Livro X”; nunca um
  endereço com cara de ação; formulário só se não tem nada para digitar nem fala
  de dispensa, exclusão, saída ou senha. Não achou o botão: o livro fica sem
  leitura e o diagnóstico do `/admin` diz **o que a tela tem** com o texto
  “Livro …” (a tag e os atributos) — é o que falta para ensinar a forma nova.
- **Quantos pedidos.** Um por livro lido: a aba (que já abre num livro) e um
  toque para cada outro.
- **O ritmo de cada livro.** O **Livro A** é o de sempre: na carona do Status e,
  com qualquer app aberto, de 20 em 20 s. Um livro que só é lido por causa de um
  ponto (**B, M**) tem dois ritmos:
  - **alguém com ponto nele está com o app aberto** → ele é relido junto com o
    Livro A, de 20 em 20 s (um toque a mais por visita). O `/api/estado` manda,
    depois da resposta, os livros dos pontos de quem perguntou
    (`marcarLivrosPedidos` grava `portal_fila.pedido_em`, no máximo uma vez a
    cada 10 s por instância); o livro continua “pedido” por 45 s depois da
    última pergunta. Ao ser pedido, ele não espera o resto do minuto: a espera
    cai para 18 s, contados da última tentativa;
  - **ninguém olhando** → só na carona do Status, **uma vez por minuto** (a
    reserva dele dura 45 s, a mesma espera do Status — com várias contas olhadas
    no mesmo minuto, ele não é lido a cada conta).

  A visita que só veio buscar o Livro B leva o Livro A junto (a aba já abre
  nele: nenhum pedido a mais) e adia a hora do A — a aba não é aberta de novo,
  segundos depois, só por ele. Com A, B e M em uso e ninguém com o app aberto:
  3 pedidos por minuto; com um motorista do Livro B olhando: 2 a cada 18 s.
- **Livro novo.** O primeiro dado de um livro que acabou de ganhar o primeiro
  ponto vem na próxima olhada do Status (até 1 minuto); até lá o cartão mostra
  “sem leitura da fila”.
- **`PORTAL_FILA_LIVROS`** (padrão `A`) são os livros lidos **sempre**, com ou
  sem ponto neles; `A,B,M` lê os três o tempo todo.
  **`PORTAL_FILA_LIVROS_DOS_PONTOS=0`** (ou `desligado`) é a chave de retorno:
  os livros dos pontos deixam de entrar sozinhos e volta a valer só a lista de
  cima.

Ponto de um livro que não é lido (ou cuja leitura não veio) aparece com “sem
leitura da fila”: sem posição e sem aviso de vez (o aviso de saída, que vem do
Status, continua).

**O que o card mostra** (`src/lib/fila-card.ts`): “Pontos no quadro TRUCK” e
“Pontos no quadro CAVALO/C” com a contagem e, embaixo, o último escalado de cada
quadro — **do livro do ponto que está na tela**. Arrastando o número para o
lado, se o ponto que entra é do Livro B ou do Livro M, os dois quadros passam a
ser os desse livro. Sem ponto na tela (visitante, ou quem ainda não cadastrou),
são os do Livro A — nunca a soma dos livros que os pontos de outros motoristas
fizeram o app ler. Quadro sem leitura mostra “—”, nunca um número antigo.

**Cada livro tem a hora da sua leitura.** Cada quadro vai para o app com a hora
em que o livro dele foi lido (`lidoEm`) e, se essa leitura passou da validade
(3 min), com a marca `velha`. “Atualizado há…” fala do livro do ponto que está
na tela, e **OFFLINE é por livro**: se o Livro B parou de vir, quem olha um
ponto do Livro B vê os últimos números com a idade verdadeira e o selo OFFLINE;
quem olha o Livro A continua ONLINE. O monitor inteiro só fica OFFLINE quando
nenhum livro tem leitura valendo.

**Leitura rígida** (`src/lib/portal-fila-parse.ts`). O HTML de verdade da aba
nunca foi visto — só a tela. Um quadro só vale se o SEQ vai de 1 a N sem pular,
todos os pontos são do livro do quadro, nenhum se repete, o “Total” bate com as
linhas e não sobra no quadro um código de ponto que não entrou em tabela
nenhuma. Página cortada, quadro pela metade ou tela diferente do esperado: a
leitura é **recusada**, com o motivo, e continua valendo a última fila boa.
Dois casos merecem nota:

- **quadro que não aparece na tela** (o portal pode não desenhar a fila sem
  pontos): vale como fila vazia só com a página inteira, o outro quadro do livro
  lido e nenhum ponto escrito fora das tabelas;
- **fila grande que “sumiu”**: um quadro que tinha mais de 8 pontos há menos de
  10 minutos e agora vem vazio não é aceito (`motivoDaFilaSumida`). Se a fila
  esvaziou mesmo, a leitura passa a valer depois desses 10 minutos.

**ONLINE / OFFLINE.** Uma fila lida vale por `max(3 min, 2,5 × o intervalo do
Status)`. Depois disso o selo vira OFFLINE, os últimos números continuam na
tela com a idade da leitura e **nenhum ponto é conferido** — fila velha nunca
muda a situação de um ponto. O que o quadro antigo deixou gravado não é
reaproveitado.

**Onde ver o que aconteceu.** `/admin → Portal do motorista → “Fila do app”`:
o que cada livro trouxe, a hora, a conta que leu e, se a última tentativa não
serviu, o motivo e as primeiras linhas da tela. “Ler agora” num motorista lê a
aba na hora, sem esperar o ciclo.

**Volta ao quadro antigo.** `FONTE_FILA=quadro` religa a leitura do quadro
público (direta e, de reserva, pelo Composio). Só serve se ele voltar a existir.
A leitura da aba “Fila” depende da rodada do Status: com
`PORTAL_FONTE_SAIDA=quadro` essa rodada não existe e a aba não é lida.

Testes: `tests/portal-fila.test.ts` (a leitura da tela, sem rede e sem banco),
`tests/fila-card.test.ts` (o card), `tests/portal-fila-cron.test.ts` (o ciclo
inteiro, com PostgreSQL local) e `tests/portal-fila-entre-ciclos-cron.test.ts`
(a leitura entre os ciclos, também com PostgreSQL local).


## Saldo de Ganhos: as viagens da semana (aba “Ticket” do portal)

O card **Saldo de Ganhos** (SERVIÇOS) abre `/consulta-ponto` e mostra, para o
motorista logado, só três números da semana: **viagens, valor bruto e
comissão** — **um saldo só, somando todos os pontos** que ele tem no app. Até
11/11/2026 ele se chamava “Consulta de Ponto” e apontava para o
quadro público que a Copadubo desligou — por isso o endereço da página e os
nomes internos continuam `consulta-ponto`.

**De onde vem.** Da aba **“Ticket”** do Portal do Motorista (“2ª Via de
Ticket”): o servidor escolhe o ponto na lista PONTO, a semana de hoje na lista
SEMANA, envia o “Gerar” e lê o cartão “Lançamentos” (PONTO · QUANT · VALOR ·
SERVIÇO e, quando presentes, DATA · HORA). O “Gerar PDF” nunca é aberto.

**A conta** de cada ponto é a do Cálculo de Frete (`src/lib/frete.ts`, a mesma
função `calcular`): frete da viagem = Quant (t) × Valor (R$/t); valor bruto do
ponto = soma das viagens dele; comissão do ponto = bruto × **a porcentagem
daquele ponto**. O **saldo** é a soma dos pontos — viagens, bruto e comissão —,
feita em centavos (`saldoDosPontos`), para o total fechar com a linha de cada
ponto na tela.

**Uma porcentagem para cada ponto.** Cada ponto do app tem a sua
(`portal_ticket_porcentagens`, em centésimos, uma linha por motorista e ponto).
Com um ponto só, a página é “Sua porcentagem”, como sempre; com dois ou mais,
“Porcentagem de cada ponto”: uma linha por ponto, com “Cadastrar” / “Trocar”.
Enquanto **algum ponto do app está sem porcentagem**, viagens e bruto aparecem
normalmente e, no lugar da comissão do saldo, o card escreve **“Falta %”**
(“Cadastre a % do A063”) — nunca um total que deixa um ponto de fora, e nunca
R$ 0,00. Ponto cadastrado depois nasce sem porcentagem. Quem tinha UMA
porcentagem (versão de 11/11/2026): ela foi copiada, uma única vez, para cada
ponto que o motorista tinha no app (`portal_ticket_config.por_ponto_em` marca
quando); a coluna antiga `porcentagem_centesimos` continua lá e guarda só a
última porcentagem salva.

**Quem é lido.** Só o motorista que **cadastrou a porcentagem** de pelo menos um
ponto na página (é isso que liga a consulta) e que tem o acesso ao portal e um
ponto no app. Ligada a consulta, **todos os pontos dele no app são lidos**, com
ou sem porcentagem. As porcentagens ficam no servidor, para o card valer em
qualquer aparelho dele. “Desligar o Saldo de Ganhos” apaga as porcentagens e as
viagens guardadas; remover o acesso ao portal apaga as viagens.

**Como é lida** (`src/lib/portal-ticket.ts`, `monitorarTickets` em
`src/lib/portal-monitor.ts`):

- **nunca faz login**: usa a sessão que a olhada do Status deixou guardada. Se o
  portal pedir o login de novo, a leitura para e espera a próxima olhada do
  Status reabrir a sessão;
- é uma passada **separada, depois da rodada do Status** — o aviso de saída do
  ponto nunca espera o Ticket. No cron, uma leitura nova só começa até 36 s
  depois do início; na rodada de quem abre o app, até 20 s e no máximo dois
  motoristas;
- a cada **5 minutos por motorista** (`PORTAL_TICKET_INTERVALO_MIN`, 2 a 60); a
  reserva em `portal_ticket_config.proxima_leitura_em` é atômica. Depois de uma
  leitura que não trouxe nada, tenta de novo em 1 minuto. O botão **Atualizar**
  lê na hora (no máximo um toque a cada 20 s);
- **todos os pontos cadastrados no app, na mesma leitura** (um “Gerar” para cada
  um; quem nunca foi lido primeiro, depois a tentativa mais antiga). Só acima de
  10 pontos há rodízio. Uma leitura é a tela do formulário e um pedido por ponto
  (o dobro quando o formulário tem código escondido; mais quando a lista repete
  o código), com **12 s de prazo até 3 pontos e 2 s a mais por ponto, no máximo
  20 s** (`prazoDoTicketMs`). A leitura também tem hora para acabar dentro da
  função que a chamou (cron: 50 s; app aberto: 42 s; “Atualizar”: 24 s). O ponto
  que não couber fica com o motivo e **abre a leitura seguinte**;
- a semana é a que contém **hoje (Brasília)** na lista do portal; na segunda-feira
  em que duas semanas contêm o dia, vale a que o portal deixa marcada. As
  viagens ficam guardadas por semana (`portal_tickets`) por 70 dias;
- código que aparece **duas vezes** na lista PONTO: cada opção é lida (até 3) e
  os lançamentos iguais contam uma vez só. Se as linhas não têm data e hora,
  não é possível distinguir com segurança viagens iguais: o ponto fica sem
  leitura nova em vez de somar ou descartar viagens por adivinhação.

**Leitura rígida** (`src/lib/portal-ticket-parse.ts`). O HTML de verdade da aba
nunca foi visto. A foto com viagens mostra quatro colunas e uma barra de
rolagem horizontal, portanto pode haver outras colunas fora da imagem. Os
valores visíveis foram usados em testes de regressão, não em treinamento de IA.
Uma leitura só vale se o período escrito, quando presente, é o da semana
pedida, cada linha tem o ponto pedido, Quant e Valor nos formatos do ticket
(toneladas com até três casas; R$ por tonelada) e dentro das faixas da
calculadora, e a data, quando informada, cai dentro da semana. Se o HTML tiver
só quatro colunas, exige-se também o total geral de viagens e toneladas
conferido; data e hora não são inventadas. Sem lançamento, só vale o “Nenhum lançamento
encontrado para este período”. Tela diferente, página cortada ou linha fora do
padrão: a leitura é **recusada**, com o motivo, e continua valendo a última boa
— com a hora dela na tela. Um número errado de dinheiro é pior do que nenhum.

**O que aparece.** No card: Viagens / Bruto / Comissão e uma nota só: leitura
antiga leva a hora (“Lido 09:10”); soma parcial diz “1 de 3 pontos”; com tudo
lido e uma porcentagem faltando, de qual ponto (“Cadastre a % do A063”) — o
“Falta %” fica sempre no lugar da comissão (`src/lib/ticket-card.ts`). Na
página: os três números do saldo, a porcentagem de cada ponto, a lista de
viagens por ponto (com o bruto e a comissão dele), o “Atualizar”, o motivo
quando a leitura não veio e um aviso que diz as duas coisas quando falta
porcentagem e falta ler um ponto (o caso do ponto recém-cadastrado).
`/admin → Portal do motorista
→ “Saldo de Ganhos”` mostra só a **saúde** da leitura (quantos pontos lidos, a
hora, o motivo da recusa): viagens, valores, porcentagem e comissão são do
motorista e não aparecem no painel nem no diagnóstico.

`PORTAL_TICKET=desligado` desliga a leitura. Com `PORTAL_FONTE_SAIDA=quadro` não
existe a rodada do Status e o Ticket também não é lido sozinho.

**API** (`/api/tickets`, só com a sessão do motorista): `POST { "porcentagens":
{ "A032": "18", "A063": "20,5" } }` salva a de um ou mais pontos — só dos
pontos que ESSE motorista tem no app; o formato antigo `{ "porcentagem": "18" }`
só vale para quem tem um ponto. As telas mandam o cabeçalho
`x-saldo-de-ganhos: 2`: um app aberto antes desta versão (sem recarregar) não
manda e, enquanto faltar a porcentagem de algum ponto, recebe a resposta de quem
ainda não cadastrou — ele não saberia mostrar a comissão em branco.

Testes: `tests/portal-ticket-parse.test.ts` (a tela), `tests/portal-ticket.test.ts`
(a leitura contra um portal de mentira, sem rede), `tests/saldo-por-ponto.test.ts`
(a conta por ponto, o saldo e o cadastro da porcentagem), `tests/ticket-card.test.ts`
(o card e a página) e `tests/portal-ticket-cron.test.ts` (o ciclo inteiro, com
PostgreSQL local).


## Saída do ponto: quem decide é o Status do portal

Para cada ponto, o app guarda a última situação lida no Status do portal
(`portal_situacoes`). A cada leitura (`src/lib/portal-monitor.ts`) ele compara,
e é a **troca** que gera o aviso — **um só**, com o que o Status mostra:

| O Status passou a mostrar | O que o motorista recebe |
| --- | --- |
| **ESCALADO** | “🚛 Seu ponto foi ESCALADO” + as linhas do cartão do ponto, como o portal escreve |
| **EM DISPENSA** | “🟥 Seu ponto foi para a DISPENSA” + o motivo e há quanto tempo |
| **ATIVO** de novo | “🟦 Seu ponto está ATIVO” — voltou para a fila (antes: ESCALADO ou EM DISPENSA) |
| a mesma situação da leitura anterior | nada |
| a **primeira** leitura do ponto | nada: é só o ponto de partida. Cadastrar a senha com o ponto já ESCALADO não dispara aviso |

O **quadro** não participa dessa decisão: quando o número some do quadro (ou
volta para ele) fica só uma linha no histórico, sem aviso. Ele segue mostrando
a fila e avisando “perto da vez” e “na vez”.

Exemplos (dados inventados):

- **escalado** → “Olá, Fulano! Seu ponto A032 foi ESCALADO.” e, linha a linha, o
  que estiver no cartão: `Desde hoje, 11:32 · há 2 min`, `Navio: …`,
  `Terminal: …`. O leitor **não supõe o nome dos campos**: vai o que o portal
  escrever, sem o menu, o rodapé, os botões e o nome do próprio motorista;
- **dispensa** → “Olá, Fulano! Seu ponto A032 saiu para a DISPENSA (motivo 001 -
  OFICINA). Está nessa situação há 9 min. Assim que voltar para a fila, eu
  aviso.”;
- **voltou** → “Olá, Fulano! Seu ponto A032 voltou para a fila: o Status do
  Portal do Motorista mostra ATIVO (antes: ESCALADO).”

Garantias: a troca é gravada de forma atômica — a mesma mudança lida por duas
funções ao mesmo tempo (cron e app aberto) gera **um aviso só**; motorista com
dois pontos recebe os dados do cartão **daquele** ponto; o cartão de outro ponto
nunca vira a situação deste; e uma situação lida há mais de 5 min (ou três
intervalos) deixa de aparecer no app como atual.

No app, o selo do ponto mostra **ESCALADO** ou **DISPENSA** quando o Status diz
isso — mesmo que o número ainda apareça no quadro — e a tela “Portal do
motorista” lista a situação de cada ponto com a hora da leitura.

Tudo isso depende do mesmo agendamento que o monitoramento com o app fechado já
exige: `/api/cron` **a cada minuto** (Supabase pg_cron ou `vercel.pro.json`).
Com o cron diário do plano Hobby e o app fechado, o Status só é lido quando
alguém abre o app.

> **Antes de ligar para todos:** são cerca de **1.440 consultas por dia em cada
> conta**, feitas a partir do servidor. A Copadubo pode limitar, pedir captcha
> ou bloquear a conta ou o endereço do servidor — combine com ela antes. Se o
> portal só aceitar uma sessão por conta, o app e o motorista (no navegador
> dele) podem derrubar a sessão um do outro. `PORTAL_INTERVALO_MIN` espaça as
> leituras e `PORTAL_FONTE_SAIDA=quadro` volta ao comportamento anterior.

> As telas logadas não são públicas: o leitor foi calibrado por prints
> (09/11/2026) e os testes usam um portal de mentira — esta leitura **nunca foi
> testada no portal de verdade**. Na primeira troca real, confira em
> `/admin → Portal do motorista` a situação guardada de cada ponto, “Ver o que
> foi lido” e o diagnóstico da leitura (sessão reaproveitada ou login, abas
> achadas, situação lida).

### Voltar ao quadro como fonte (`PORTAL_FONTE_SAIDA=quadro`)

Com `PORTAL_FONTE_SAIDA=quadro` no ambiente vale o comportamento anterior: é o
**quadro** que percebe a saída (a fila marca `SAIU`) e o portal é consultado uma
vez — com um login novo — para dizer o que aconteceu. A saída fica em
`portal_saidas_pendentes` e `processarSaidasPendentes()` (`src/lib/estado.ts`)
manda **um aviso só**:

| O portal mostra | O que o motorista recebe |
| --- | --- |
| **ESCALADO** | “🚛 Seu ponto foi ESCALADO” + as linhas do cartão do ponto |
| **EM DISPENSA** | “🟥 Seu ponto foi para a DISPENSA” + o motivo e há quanto tempo |
| **ATIVO**, e o número é o **Último Escalado** do quadro | o aviso do quadro, na hora, dizendo que o portal ainda mostra ATIVO |
| **ATIVO**, e o número só **sumiu** do quadro | nova consulta em +1, +2 e +3 min. Voltou ao quadro: cancela sem avisar. Continuou ATIVO: aviso do quadro dizendo exatamente isso |
| portal fora do ar / tela sem a situação | uma nova tentativa no ciclo seguinte; depois, o aviso do quadro (“destino não foi confirmado”) |
| senha recusada, captcha ou sem CPF/senha | o aviso do quadro, na hora |

Nesse modo quem não cadastrou o CPF/senha continua recebendo o aviso do quadro,
o portal só é relido com um ponto fora do quadro (a cada 10 min, por até 6 h) e
nenhuma saída fica sem aviso (passados 5 min, sai com o que houver).

### Teste no `/admin`

`/admin → Portal do motorista → **Saída do ponto (teste)**`. A leitura
automática acima **não depende** destes modos — eles valem só para os botões de
teste (gravados em `configuracao.portal_saida_modo`):

| Modo | O que acontece no teste manual |
| --- | --- |
| `desligado` | nada é enviado (só o registro no painel) |
| `somente_admin` (**padrão**) | o portal é lido e o aviso aparece no painel, mas **nada chega no celular** |
| `motoristas` | o botão do painel também envia para o celular do motorista |

No cartão dá para ver a **situação guardada de cada ponto** (ATIVO / ESCALADO /
EM DISPENSA, com a hora da leitura), **Simular mensagem** (cenários ESCALADO e
dispensa — e, com a fonte `quadro`, os dois casos de portal ainda ATIVO — com
telas de exemplo, sem rede e sem enviar; o texto é montado pelas mesmas funções
do envio de verdade), **Ler o portal agora** (leitura real do motorista
escolhido, na sessão guardada) e ver os **últimos avisos registrados** em
`portal_eventos`, cada um com “o que o leitor viu no portal”.
“Telas extras” fica vazio: o leitor abre o Status e as abas do menu. Tudo passa
pela auditoria; CPF e senha continuam cifrados e nunca aparecem.

### Testes

- `tests/portal-login.test.ts` — login contra um portal de mentira
  (`tests/portal-fixture.ts`): redirecionamentos, troca de cookie, senha errada,
  captcha, portal fora, `404` que não é login, senha que só sai para o portal;
- `tests/portal-status-situacao.test.ts` — as regras do Status como fonte: que
  aviso cada troca pede, configuração por ambiente, sessão guardada (uma leitura
  = um pedido; freio de logins), selo do ponto e o chamado para cadastrar;
- `tests/portal-status-monitor.test.ts` — de ponta a ponta com PostgreSQL local:
  primeira leitura sem aviso, ESCALADO / DISPENSA / volta, dois pontos, sessão
  encerrada, senha recusada, portal fora do ar, duas rodadas ao mesmo tempo;
- `tests/portal-saida-status.test.ts` — leitura de ATIVO / ESCALADO / EM
  DISPENSA, dois pontos, decisão do aviso, texto final, leitura periódica;
- `tests/portal-saida-cron.test.ts` e `tests/cron-push.test.ts` — a saída
  decidida pelo quadro (`PORTAL_FONTE_SAIDA=quadro`), de ponta a ponta;
- `tests/portal-copadubo.test.ts` e `tests/portal-tela.test.ts` — leitor
  genérico, telas, rotas, cron e cartão do `/admin`.

## Tempo e orientações: memória da IA, sem avisos automáticos

A política do proprietário (`src/lib/politica-automacao.ts`) desativa a publicação
espontânea de previsão do tempo, alertas meteorológicos, dicas e orientações de
comportamento no porto. Isso também vale para `forcar` e para a verificação pelo
administrador. **Não foram modificados componentes, telas, estilos ou imagens.**

- A tela do tempo, as fontes APPA/SIMPORT/Open-Meteo e o radar do administrador
  continuam disponíveis. As leituras atualizam silenciosamente a memória.
- As 11 orientações de porto permanecem em `REGRAS` e no PostgreSQL para
  responder perguntas, não para disparar Push quando um ponto sai para o trabalho.
- A IA tenta dados atuais ao receber uma pergunta de clima. Se precisar usar
  memória antiga, o contexto identifica a data e não a apresenta como tempo atual.
- Avisos automáticos antigos de clima, radar e boas-vindas são excluídos da
  listagem, do polling e do contador do chat; mensagens humanas são preservadas.
  Reabra o app para atualizar um feed que já estava carregado.
- A fila pessoal, seus avisos NA VEZ/SAIU e o restante do aplicativo não mudaram.

Veja [a documentação do monitor](docs/MONITORAMENTO_NAVIOS.md).

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
Cada motorista cadastra em **menu ⋮ → Sobre → Monitor WhatsApp** os códigos A/B/M que deseja
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

A tela inicial mostra uma imagem no topo
(`public/images/Interface CopaLinks em Tema Escuro(1).png`, 850×540), numa
moldura com a **proporção do próprio arquivo** — nada de deformar, cortar ou
sobrar azul. As fotos personalizadas dos motoristas entram na proporção gerada
pelo servidor (**1536×1024**). A
foto é mostrada **nítida, sem véu azul** (era assim antes e sujava o céu): a
máscara `.imagem-nitida` (`src/app/globals.css`) deixa 0–95% exatamente como o
arquivo original e só os últimos **5% da base** se dissolvem no fundo
Dark Navy `#000D16` do app, para não ficar linha dura.

O **cartão do número começa exatamente nos 5% finais da foto**: 5% da altura =
3,3333% da largura (altura = largura ÷ 1,5 — exato nas fotos 1536×1024; no
padrão 850×540 a diferença fica abaixo de 1 px), e o cartão sobe com
`-mt-[3.3333%]` dentro de um invólucro full-bleed (`-mx-3`) com a mesma largura
da imagem, para a conta valer em qualquer tela. A **logo e a saudação do
motorista** ficam no **canto esquerdo da parte de baixo da foto**
(`BannerCaminhao`, `bottom-[calc(5%_+_8px)] left-3`) — logo acima do cartão,
dentro da faixa de 5%, com o nome cortado em reticências para não invadir o
botão da câmera. O topo da foto ficou só com os controles discretos:
compartilhar, previsão do tempo e trocar a imagem — ícone pequeno (17 px),
ganho de toque de 44 px, fundo `bg-black/20` e borda `border-white/10`, sem
caixa azul pesada. No **canto superior esquerdo** fica o menu **⋮**
(`src/components/inicio/MenuConta.tsx`), com o mesmo peso visual: ele reúne o
que já existe na aba "Sobre" — **trocar o nome do perfil**, **ativar as
notificações** e o **painel de administração** — reaproveitando as mesmas
funções (`renomear` e `setPainelNotif("geral")`), sem criar conteúdo nem
chamadas novas. O painel abre
ancorado no botão (nasce abaixo dele, nunca vaza para fora da tela), fecha com
Esc, toque fora, rolagem ou ao girar o aparelho, e o link do admin continua
também no fim da aba Sobre. Teste: `tests/menu-conta.test.ts`.

O **rodapé de navegação é uma faixa estreita** (~69 px): ícones de 22 px,
rótulos de 12,5 px e o botão do chat de 48 px — sobra mais tela para o
conteúdo (o `pb` do app acompanha, `pb-[92px]`). O terceiro item é **Navios**
(ícone `Ship`), com um selo numérico sempre visível: a quantidade de navios de
fertilizantes **atracados**, lida de `/api/navios/espelho` a cada 30 s, e **0**
quando não há nenhum ou a leitura falha. Um toque abre `/navios`.

**Nada de voltar a cobrir a foto com degradê no topo, na esquerda ou com
brilho**, nem de subir o cartão além dos 5% — `tests/layout-largura.test.ts`
trava isso. Em **Personalizar imagem** o motorista
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

## Navios e manobras (HTTP direto com Composio de reserva)

O `/api/cron` monitora estas duas fontes no backend, usando o mesmo padrão do
quadro ativo de caminhões: tenta ler a página por HTTP direto e, se o HTML não
trouxer dados completos (por exemplo, em páginas renderizadas por JavaScript),
usa o Composio como reserva:

- **Navios atracados / saldos:** https://berth-bloom-buddy.lovable.app/
- **Manobras previstas / SINPRAPAR:** https://berth-bloom-tracker.lovable.app/

Em toda pergunta sobre navios no assistente, o servidor tenta ler novamente as
fontes antes de chamar a IA. Para horários, ações, situação e berço de manobras,
a fonte prioritária é o site **COPALINKS — Manobras Previstas** acima. O contexto
conserva os dados apresentados, indica o horário e o método da leitura e cita o
link. Se a leitura atual falhar, uma leitura salva pode ser usada, marcada como
possivelmente desatualizada; sem dados válidos, o assistente não deve inventar
informações. Se `AI_API_KEY` estiver configurada, a nova API direta responde
primeiro a perguntas sobre navios; se não estiver disponível, o assistente usa o
Composio como reserva. Em `/admin` → IA → **Testar conexão**, o botão faz uma
geração mínima real de chat (não apenas uma consulta de modelos). A API de IA
interpreta os dados fornecidos; ela não navega na web por conta própria. Os
avisos automáticos continuam determinísticos, sem texto inventado por IA.

Uma leitura válida inicial de cada fonte cria a referência silenciosa. Depois:

1. Novos navios atracados e mudanças do berço informadas pela fonte geram aviso.
2. Uma mudança de saldo gera aviso somente quando o **Saldo Total do Navio** é
   **estritamente menor que 2.000 t**, inclusive alterações de saldos das operadoras
   quando o total do navio está abaixo desse limite. Igual a 2.000 t não atende.
3. Manobras de atracação/desatracação exigem **berço definido e data/hora prevista**.
   EF (entrada e fundeio) sem berço não é anunciada como atracação. `PREVISTA` é
   preservada literalmente, sem inventar confirmação ou execução da manobra.
4. Cada atualização entra numa fila durável: **um navio por mensagem e Push**,
   com nomes, mercadorias, valores e decimais como na fonte. Sem IA para reescrever
   o aviso, sem análise de maré e sem dicas espontâneas.
5. Leituras repetidas não avisam. Uma leitura inválida/parcial não substitui a
   memória anterior e desaparecimento não prova desatracação. Fontes são independentes.

O envio respeita o silêncio do chat e tem recibos persistentes por aparelho para
retentar falhas temporárias sem reenviar aos aparelhos que já tiveram o aceite
registrado. O aceite do serviço Push não garante a exibição pelo sistema operacional.

Implementação: `navios-fontes.ts`, `navios-monitor.ts`, `politica-automacao.ts`,
`ia-memoria-porto.ts`. A migração é aditiva e aplicada pelo backend quando tem
permissão de DDL; também está em `supabase/migrations/20261008_navios_composio.sql`.
A função antiga `verificarNaviosFertilizantes` delega ao novo fluxo. O módulo
`navios.ts` e a rota legada `/api/navios` permanecem compatíveis para consultas.

**Agendamento é necessário:** chamar `/api/cron` a cada minuto, usando o job
Supabase já existente ou Vercel Pro/Enterprise. Cada fonte é relida a cada 5 min.
No Hobby, o `vercel.json` continua diário: isso sozinho NÃO é monitoramento contínuo.
Consulte [GITHUB_VERCEL.md](GITHUB_VERCEL.md) e
[docs/MONITORAMENTO_NAVIOS.md](docs/MONITORAMENTO_NAVIOS.md).

Testes: `npm test`; integração isolada: `tests/navios-aviso.test.ts` com
`DATABASE_URL=TEST_DATABASE_URL` em um banco local `fila_push_test_*`.

## Cópia do COPALINKS de navios (item **Navios** do rodapé)

O terceiro item da barra inferior agora é o **Navios**: ícone de navio, nome
"Navios" e um **selo numérico sempre visível** com a quantidade de navios de
fertilizantes **atracados** — mostra **0** quando não há nenhum (e enquanto a
leitura não chega). Um toque abre `/navios`, a réplica idêntica do painel
`https://berth-buddy-bot.lovable.app/`, com todas as funcionalidades e o mesmo
tema Dark Navy do aplicativo. São duas rotas, uma para cada tela da cópia:

| Rota | Tela da cópia |
|---|---|
| `/navios` | **Navios Atracados** — berço, operadoras, mercadoria, saldo de cada operadora, barra de descarga (%) e saldo total do navio |
| `/navios/sinprapar` | **Manobras Previstas** — código (EA/EF/DF/DS/AT/MB), berço, data/hora, explicação, situação e filtros "Em manobra / Aguardando manobra / Atracado" |
| `/sinprapar` | atalho que redireciona para `/navios/sinprapar` (mesmo caminho da referência) |
| `/api/navios/espelho` | dados das duas fontes em JSON, usados pela atualização automática a cada 30 s |

O espelho monitora **exatamente dois sites oficiais** e cruza as leituras pelo
nome/IMO do navio: **APPA** (`relLineUpRetroativo`) fornece berços, operadoras,
previstos e saldos; **SINPRAPAR** (`PREV.HTM`) fornece as manobras. O filtro
`ehFertilizante` de `src/lib/navios.ts` deixa passar **somente navios de
fertilizantes** (ureia, KCl, sulfato de amônio, MAP, NPK, adubos nitrogenados…).
O percentual de descarga é `1 − saldo total / previsto total`, arredondado como
na referência. Nenhum outro site é consultado e nenhum valor é inventado.

Se uma fonte não responder, o trecho correspondente vem da última leitura
pública gravada em `src/lib/espelho-navios-referencia.json` e a tela mostra o
selo **PARCIAL/REFERÊNCIA** com o horário daquela leitura — nunca finge estar
ao vivo. Em produção (Vercel), as duas leituras são ao vivo; botão de atualizar,
links para os sites oficiais e volta ao CopaLinks ficam na própria tela.
Detalhes: [docs/ESPELHO_NAVIOS.md](docs/ESPELHO_NAVIOS.md). Testes:
`tests/espelho-navios.test.ts`.

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

## A tela sempre em dia: dados e versão

**Dados.** O app pede `/api/estado` a cada 5 s. Ao voltar do segundo plano — ou
quando a rede volta — ele pede **na hora** o estado, a contagem do chat, os
motoristas e os navios, sem esperar a próxima volta de cada ciclo
(`useAoVoltarParaATela`). Cada pedido de estado leva um número: uma resposta
atrasada nunca passa por cima de uma mais nova, e o estado que vem na resposta
de uma ação (reler, corrigir, remover, cadastrar) deixa velhos os pedidos que
ainda estavam a caminho.

**Versão.** A página é sempre buscada de novo ao **abrir** o app (`no-store`),
mas a tela que fica aberta guarda o código — e os textos — da publicação
antiga. O `VigiaDeVersao` (no layout raiz: vale para todas as páginas) pergunta
`/api/versao` quando a pessoa volta para o app (no máximo uma vez por minuto) e,
com a tela à vista, a cada 5 minutos. Se o carimbo for outro, a página se
recarrega sozinha — só num momento em que não atrapalha:

- **logo que a pessoa volta** para o app (1,2 s depois, se ela ainda não tocou
  em nada), ou com a tela à vista e **parada há 5 minutos**;
- nunca em segundo plano; nunca se algo foi digitado ou escolhido na página,
  com um campo em foco, com áudio tocando ou com uma janela aberta por cima (a
  conversa, um alerta — tudo que usa `aria-modal`, ou um trecho marcado com
  `data-sem-recarga`); nunca em `/admin` e `/monitor`;
- só logo depois de o servidor responder, em até 4 s — sem rede, ou com rede
  ruim, a tela fica como está;
- nunca em laço: a mesma aba recarrega no máximo 2 vezes atrás da mesma versão,
  com 10 minutos entre uma e outra (anotado no `sessionStorage`).

O carimbo é o commit (12 caracteres) mais o fim do número da publicação na
Vercel (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`), posto no código na
compilação (`next.config.ts` → `NEXT_PUBLIC_VERSAO_APP`). **`GET /api/versao`**
responde `{ "versao": "…" }`: é também o jeito de conferir qual publicação está
no ar. `VERSAO_APP` fixa o carimbo à mão; fora da Vercel e sem ela o carimbo
fica vazio e o vigia não liga.

As regras e a ligação com o navegador estão em `src/lib/atualizacao-da-tela.ts`;
os testes, em `tests/atualizar-rapido.test.ts`.

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

**Atualizar o esquema do banco:** rode
[`supabase/migrations/20261106_atualizacao_completa.sql`](./supabase/migrations/20261106_atualizacao_completa.sql)
no SQL Editor do Supabase (idempotente, não apaga dados) e confira com
`npm run db:checar`. O passo a passo está em
[supabase/ATUALIZAR.md](./supabase/ATUALIZAR.md).

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `DATABASE_URL` | sim | conexão PostgreSQL do Supabase (servidor, via Drizzle) |
| `SITE_URL` | recomendada | endereço público fixo para links de compartilhar |
| `CRON_SECRET` | recomendada | autenticação do Cron diário da Vercel |
| `SUPABASE_CRON_SECRET` | se usar pg_cron | chave separada do cron de 1 minuto; o mesmo valor fica no Supabase Vault |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | sim, para Monitor WhatsApp nativo | JSON privado de conta de serviço Firebase, só na Vercel; nunca no Android/GitHub |
| `SECRETS_MASTER_KEY` | não | chave mestra das API Keys do painel (e do CPF/senha/sessão do Portal do Motorista) |
| `PORTAL_FONTE_SAIDA` | não | quem decide a saída do ponto: vazio/`portal` = o Status do Portal do Motorista (padrão); `quadro` = o quadro da intranet, com uma consulta ao portal na saída |
| `FONTE_FILA` | não | de onde vem a fila: vazio/`portal` = a aba “Fila” do Portal do Motorista (padrão); `quadro` = o quadro público antigo, desligado pela Copadubo em 10/11/2026 |
| `PORTAL_FILA_LIVROS` | não | livros lidos **sempre** na aba “Fila” (padrão `A`); ex.: `A,B,M`. O livro de cada ponto cadastrado entra sozinho — cada livro a mais é um pedido a mais por leitura |
| `PORTAL_FILA_LIVROS_DOS_PONTOS` | não | `0` (ou `desligado`) = chave de retorno: só os livros de `PORTAL_FILA_LIVROS` são lidos, como era antes |
| `PORTAL_FILA_INTERVALO_S` | não | com o app aberto, de quantos em quantos segundos a aba “Fila” é relida entre as olhadas do Status (10 a 60; padrão 20). `0` ou `desligado` = só na carona do Status, uma vez por ciclo |
| `PORTAL_INTERVALO_MIN` | não | de quantos em quantos minutos o Status de cada motorista é lido (1 a 60; padrão 1) |
| `PORTAL_TICKET` | não | Saldo de Ganhos: vazio = a aba “Ticket” é lida, com todos os pontos do app, para quem cadastrou a porcentagem (padrão); `desligado` = nenhuma leitura do Ticket |
| `PORTAL_TICKET_INTERVALO_MIN` | não | de quantos em quantos minutos o Ticket de cada motorista é lido (2 a 60; padrão 5) |
| `VERSAO_APP` | não | fixa à mão o carimbo da publicação que a tela compara com `/api/versao` (na Vercel ele é montado sozinho, do commit e do número da publicação) |
| `PORTAL_MOTORISTA_URL` | não | base do portal, só para teste/homologação; em produção fica vazia |
| `ADMIN_SETUP_CODE` | só no primeiro cadastro | código para criar o primeiro administrador |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | não | chaves de notificação (o app gera e guarda no banco se ausentes) |
| `NAVIOS_MONITOR_MIN` / `NAVIOS_MAX_POR_CICLO` | não | intervalo das leituras (5 min) e quantidade de avisos individuais por ciclo (10); não mudam o visual |
| `CLIMA_MONITOR_*` | não | radar silencioso para memória da IA: `ATIVO`, `MIN` (minutos entre leituras), `PAINEL_MIN` (releitura do painel da APPA), `SENSIBILIDADE` (baixa/média/alta), `AVISO_MIN`, `MAX_HORA` |
| `APPA_*` / `SIMPORT_*` | não | leitura do painel da APPA com fallback: `SIMPORT_PAINEL_URL`, `APPA_DADOS_API`, `APPA_BOLETIM_API`, `SIMPORT_AUTH_TOKEN`, `APPA_NAVEGADOR_MODULO`, `APPA_CDP_URL`, `APPA_LEITURA_TIMEOUT_MS`, `APPA_NAVEGADOR_TIMEOUT_MS`, `APPA_OCR_URL`, `APPA_OCR_IDIOMA` |

Segredos opcionais (Composio, WhatsApp, IA) podem ser cadastrados no `/admin`:
ficam **cifrados no banco** e nunca são enviados ao navegador. As chaves do
Supabase REST não são usadas pelo código do app; o banco é acessado diretamente
por `DATABASE_URL`.

O plano gratuito da Vercel executa Cron **no máximo uma vez ao dia**. Para
varrer a fila também com o app fechado sem fazer upgrade, usamos
**Supabase pg_cron + pg_net**, que chama `/api/cron` com a chave guardada no
Supabase Vault. Consulte [GITHUB_VERCEL.md](./GITHUB_VERCEL.md).

## Fundo e paleta (Dark Navy — identidade FertNavios)

O tema visual é o **Dark Navy** das referências do FertNavios: fundo sólido
quase preto azul-marinho, cartões azul-marinho com borda fina azul-acinzentada,
ciano só em botões selecionados/filtros ativos/destaques de navegação, verde
para status positivo e progresso, amarelo para status confirmado/atenção e azul
para espera/informação. **Nenhuma cor fora da paleta entra na interface** (sem
degradês chamativos, sem fundos claros, sem violeta/laranja/verde-WhatsApp).

| Papel | Cor |
|---|---|
| Fundo principal | `#000D16` |
| Fundo dos cartões | `#071A28` |
| Fundo dos painéis secundários | `#002F3B` |
| Bordas dos cartões | `#183341` |
| Ciano principal | `#00B8BC` |
| Verde de sucesso | `#00C853` |
| Fundo verde escuro | `#003D35` |
| Amarelo de atenção | `#FFB82E` |
| Azul informativo | `#129DFF` |
| Texto principal | `#EAF4F7` |
| Texto secundário | `#8FA8AC` |
| Ícones e elementos discretos | `#506A75` |
| Fundo das barras de progresso | `#062330` |

Tudo mora em `src/app/globals.css` (fonte única de verdade): os tokens
semânticos `--fundo-principal`, `--fundo-cartao`, `--ciano-principal` etc. em
`:root` e os tokens do Tailwind em `@theme` (`fundo`, `cartao`, `painel`,
`borda`, `ciano`, `verde`, `verdeescuro`, `ambar`, `azulclaro`/`info`, `gelo`,
`aco`, `discreto`, `progresso`). Os nomes antigos (`abismo`, `noite`,
`marinho`, `violeta`, `ouro`, `laranja`) continuam existindo como alias dos
novos valores, e as famílias padrão do Tailwind (`red-*`, `emerald-*`,
`amber-*`, `cyan-*`, `blue-*`, `white`, `black`) foram remapeadas para a
paleta — por isso nenhuma tela repete cor à mão fora dela. Os nomes
`--fundo-brilho/meio/borda/base` também viraram alias do fundo sólido
`#000D16` (as fotos de topo continuam se dissolvendo nele nos últimos 5%).
`.fundo-app`, `.cartao-monitor`, `.painel`, `.vidro`, `.campo`, `.pill` e as
barras `.progresso-trilho`/`.progresso-verde`/`.progresso-ciano` herdam o
mesmo tema. O `themeColor` do `layout.tsx`, o `manifest.webmanifest` e os
scripts de arte (`gerar-logo.mjs`, `gerar-fundo.mjs`, `gerar-divulgacao.mjs`)
acompanham o fundo `#000D16`. Regressão: `tests/tema-dark-navy.test.ts`
varre todas as telas e falha se qualquer cor fora da paleta voltar.

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
src/app        rotas e páginas (/, /tempo, /frete, /consulta-ponto, /contatos, /divulgacao, /admin, /api)
src/components telas (início, tempo, frete, chat, divulgação, admin)
src/lib        monitoramento do ponto, push, clima, integrações
scripts        exportar/importar o banco, gerar logo/fundo/artes
```

## Divulgação: a mensagem e a página de instalação

O texto que o motorista manda no WhatsApp (botão **Compartilhar** na tela de
início) e a página pública **/divulgacao** saem da **mesma lista** — em
`src/lib/compartilhar.ts`:

- `BENEFICIOS` — os nove recursos do app (monitoramento dos pontos, alertas,
  tempo, frete, assistente mecânico com IA, contatos, chat, navios e Saldo de
  Ganhos). É a fonte única: a mensagem e os cartões da página nunca divergem.
  Recurso novo entra aqui, ganha um ícone em `ICONES_BENEFICIO` (na página, na
  mesma posição) e uma linha em `RECURSOS_ARTE` (no script das artes).
- `linhasDaMensagem(link)` — a mensagem linha a linha, com os trechos em
  negrito. **Começa pelo endereço do app** (rótulo e link nas duas primeiras
  linhas), para ficar à vista sem ninguém precisar ler até o fim. O link
  aparece uma vez só; a assinatura fecha a mensagem. No WhatsApp o negrito sai com `*` (o WhatsApp não entende `**`
  nem link em markdown `[]( )`), e na página o mesmo trecho vira `<b>`.
- `mensagemCompartilhar(link)` — o texto pronto (copiar, enviar pelo
  WhatsApp ou pela folha de compartilhamento do aparelho).
- `linkWhatsAppMensagem(texto)` — link `wa.me` com a mensagem preenchida.

A página **/divulgacao** (`src/app/divulgacao/page.tsx` +
`src/components/divulgacao/DivulgacaoApp.tsx`) mostra o que o app faz, o
passo a passo de instalação **conforme o aparelho** (Chrome e Edge com o
botão de instalar, iPhone pela Tela de Início, navegador dentro do WhatsApp),
o QR Code do endereço do app, a prévia da mensagem e as artes para status.
O endereço do app vem de `src/lib/url-app.ts` (`SITE_URL` → domínio da Vercel
→ host da requisição), o mesmo usado pelo endereço canônico do layout.

**Onde o material fica:** o card de divulgação do app é do **administrador**
(`/admin → Divulgação do app`, `src/components/admin/CartaoDivulgacaoAdmin.tsx`).
Ele junta o endereço público do app, o QR Code (a câmera aponta e abre), a
mensagem pronta (WhatsApp, copiar ou compartilhar, com a arte anexada) e o
download das duas artes (status 1080×1920 e cartão do link 1200×630), com
link para a página pública `/divulgacao`, que fica com o passo a passo de
instalação. O card saiu da aba "Sobre" do app do motorista: quem divulga é o
administrador.

**Artes:** `node scripts/gerar-divulgacao.mjs` (aceita
`--url=https://copa-links.vercel.app`) gera
`public/images/compartilhar.jpg` (1200×630, a imagem que vai com a mensagem do
botão Compartilhar e a prévia do link do app, com o celular mostrando a tela
inicial), `public/images/divulgacao-status.jpg` (1080×1920, status do WhatsApp) e
`public/images/divulgacao-card.jpg` (1200×630, prévia do link da /divulgacao).
As três listam os recursos de `RECURSOS_ARTE`, na ordem de `BENEFICIOS`; com
número ímpar, o último ocupa a largura das duas colunas. **Depois de gerar,
aumente o `?v=`** das três imagens em `src/lib/compartilhar.ts` e em
`src/app/divulgacao/page.tsx` — sem isso o celular e o WhatsApp continuam com a
imagem antiga guardada. Para o texto
sair com as fontes da marca (Archivo e Space Grotesk), converta os `.woff2` do
`@fontsource` em `.ttf` e instale no sistema (ex.: em `~/.fonts`); sem isso o
script usa a fonte padrão e as imagens continuam legíveis.

Teste: `tsx --test tests/divulgacao.test.ts` (a mensagem, a página, as artes e
a URL do app).


## Push em segundo plano
A réplica usa servidor + VAPID + Service Worker. Para notificações com a interface fechada, configure o `/api/cron` para rodar aproximadamente a cada minuto e defina `CRON_SECRET`. Consulte `GITHUB_VERCEL.md`.
