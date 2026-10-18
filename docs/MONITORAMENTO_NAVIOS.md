# Monitoramento de navios por HTTP direto — Composio de reserva

## Escopo implementado

O backend tenta ler diretamente por HTTP as mesmas páginas públicas que monitora; quando uma página é renderizada por JavaScript ou o HTML não traz dados completos, o Composio é usado como reserva. O backend existente do CopaLinks compara as leituras, persiste a memória e envia mensagens pelo chat e pelo Web Push que já existem. Não foi criado painel, cartão, tela, botão ou indicador de navios. Componentes, estilos, imagens, Android e Service Worker não foram modificados.

Fontes autorizadas, fixadas em `src/lib/politica-automacao.ts`:

| Dados | Fonte |
|---|---|
| Navios atracados, operadoras e saldos | https://berth-bloom-buddy.lovable.app/ |
| Manobras previstas / SINPRAPAR | https://berth-bloom-tracker.lovable.app/ |

O link curto Google enviado pelo proprietário aponta para a segunda página. A automação usa a URL canônica, sem depender desse redirecionamento.

### Regras

- Avisos automáticos do chat: somente navios, manobras previstas, atracação e desatracação. Mensagens humanas não são filtradas por assunto.
- Um navio por mensagem e por notificação. Se três navios mudarem, haverá três mensagens independentes, não uma mensagem agrupada.
- Saldo: usar **Saldo Total do Navio**, estritamente **menor que 2.000 toneladas**. Não confundir com capacidade/DWT, toneladas previstas ou saldo de uma única operadora. Igual a 2.000 não atende.
- Enquanto o saldo total estiver abaixo desse limite, uma alteração real dos saldos (total ou de operadoras) gera aviso. Oscilação A → B → A também é uma nova atualização observada.
- Navio que aparecer atracado e mudança explícita do berço também podem gerar aviso, independentemente do saldo.
- Previsão de manobra: exigir berço informado e data/hora válida. Aceitar berços nomeados, como FOSPAR EXT BB, além dos numéricos. EF (entrada e fundeio) não é anunciado como atracação.
- Reproduzir nomes, mercadorias, saldos, decimais, datas, situação e código da fonte. Não usar Gemini para reescrever avisos, não arredondar, não incluir maré, clima ou dicas.
- PREVISTA continua PREVISTA; não significa CONFIRMADA nem manobra realizada. Cancelamento só é comunicado se a própria fonte o registrar com a manobra.
- Ausência de navio, erro, resposta vazia ou página cortada nunca prova desatracação. Não há substituição silenciosa das duas fontes por dados de outro site.
- Primeira leitura válida de **cada** fonte cria uma referência silenciosa, sem disparar informações antigas. Só as mudanças posteriores geram avisos.

## Tempo e orientações na memória da IA

A política bloqueia boletins, radar, alertas meteorológicos, dicas de comportamento, regras automáticas após saída para o trabalho e boas-vindas automáticas no chat. Nem `forcar` ou configurações antigas reativam esses agentes.

A tela de tempo e o radar do administrador continuam intactos. Leituras do tempo atualizam a memória; perguntas sobre navios tentam leitura fresca sem alterar a referência de comparação do monitor. As orientações de porto continuam disponíveis quando perguntadas; não substituem o regulamento oficial vigente.

Em cada pergunta sobre navios, o servidor tenta buscar novamente as duas fontes por HTTP direto e valida a resposta; se não encontrar dados completos (como em uma página renderizada por JavaScript), usa o Composio como reserva. Essa leitura da IA não altera a memória de comparação do monitor nem cria avisos. A `AI_API_KEY`, quando configurada, responde primeiro usando o contexto recém-lido; sem chave própria, o chat usa Gemini/OpenAI pelo Composio. Se a fonte falhar, uma leitura salva pode ser informada com o horário e marcada como potencialmente desatualizada. Para ações, situação, data, hora e berço de manobras, o assistente prioriza os dados literais de https://berth-bloom-tracker.lovable.app/. O modelo não navega por conta própria. O botão **Testar conexão** em `/admin` faz uma chamada real de geração de texto ao provedor escolhido. Os avisos automáticos permanecem sem IA, com os parsers e as validações determinísticas descritas abaixo.

Memória no PostgreSQL (`configuracao`):

- `ia_porto_politica_v2`: regras permanentes desta automação.
- `ia_porto_orientacoes_v2`: orientações de porto cadastradas.
- `ia_porto_ultima_previsao_v2`: última previsão válida, com data da leitura.

Se a IA usar clima ou navios conservados porque a leitura atual falhou, seu contexto identifica que a informação é antiga. Perguntas não publicam mensagens no chat coletivo nem alteram a referência de comparação do monitor.

Mensagens automáticas antigas que deixaram de ser permitidas ficam fora do feed, do polling e do contador do chat. Não há exclusão em massa de mensagens humanas. Um feed que já estava aberto precisa ser reaberto/atualizado para refletir a nova listagem. Avisos já exibidos no sistema operacional não são retirados remotamente por esta mudança.

## Fluxo e persistência

```text
Cron autenticado (a cada minuto)
  ├─ fila pessoal existente (inalterada)
  └─ monitor de navios
       ├─ lease persistente por fonte
       ├─ HTTP direto em cada página; Composio só como reserva (a cada 5 minutos)
       ├─ parser determinístico e validação de leitura completa
       ├─ comparação com a última leitura válida
       ├─ memória + outbox na mesma transação
       └─ uma mensagem por navio + Push com recibo por aparelho
```

- `navios_monitor_fontes`: último texto literal, dados interpretados, horário da última leitura **válida**, erro e trava de leitura por fonte.
- `navios_monitor_eventos`: fila durável, revisão, mensagem publicada, estado e tentativas de Push.
- `push_entregas`: aceite por tag/aparelho. Um aparelho com falha temporária pode ser tentado novamente sem reenviar aos aparelhos que já tiveram o aceite registrado.
- Uma fonte indisponível não bloqueia a outra. Falha da fila pessoal não impede o monitor de navios.
- Leituras repetidas e cron concorrente não criam mensagens repetidas. Chat e referência da mensagem são gravados atomicamente.
- Quem silenciou o chat não recebe esses Push. Notificações da fila continuam funcionando.
- O payload do aviso de navio conserva o texto, sem o corte de 220 caracteres usado para mensagens humanas. A interface do sistema operacional pode encurtar a visualização.
- Aceite pelo serviço Push não prova exibição ou leitura no celular. Em falhas de rede com resultado ambíguo, o mesmo identificador/tag ajuda a evitar avisos visuais duplicados; não existe garantia absoluta de entrega externa exatamente uma vez.
- Histórico de eventos/recibos: 60 dias. O chat mantém a retenção existente.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/politica-automacao.ts` | Escopo, fontes e limite fixo de 2.000 t |
| `src/lib/navios-fontes.ts` | Parsers, valores literais e detecção de mudanças |
| `src/lib/navios-monitor.ts` | HTTP direto com reserva Composio, leases, transações e outbox |
| `src/lib/navios-migracao.ts` | DDL aditivo e idempotente |
| `src/lib/ia-memoria-porto.ts` | Memória persistente para perguntas |
| `src/lib/chat-politica.ts` | Filtro do histórico e contador |
| `src/lib/chat-push.ts`, `src/lib/push.ts` | Política de agentes e recibos por aparelho |
| `src/app/api/cron/route.ts` | Execução no backend, inclusive com app fechado |
| `supabase/migrations/20261008_navios_composio.sql` | Migração para aplicação manual, se necessária |

A função `verificarNaviosFertilizantes` permanece como ponto de entrada compatível, mas delega ao novo monitor. Utilitários antigos da APPA ficam para compatibilidade de consultas, não para o envio de avisos.

## Aplicação e ativação em produção

**Este pacote é código preparado, não confirmação de deploy ou de ativação na conta do proprietário. Não contém credenciais de produção.**

1. Aplicar o patch na revisão-base do repositório, ou copiar os arquivos do projeto atualizado:
   ```bash
   git apply --check /caminho/copa-monitoramento.patch
   git apply /caminho/copa-monitoramento.patch
   npm ci
   npm run typecheck
   npm test
   ```
   O patch foi gerado a partir da revisão `7029ccbda96eb589e8abdcdd04292515d979fc4d` da branch `main`. Se o repositório avançou, revise eventuais conflitos antes de aplicar.
2. Publicar no backend existente (deploy normal do projeto). Recomenda-se Node 22+, compatível com o `firebase-admin` que já era usado neste repositório.
3. Confirmar `DATABASE_URL` no servidor. O monitor tenta HTTP direto primeiro; mantenha também `COMPOSIO_API_KEY` no cofre do `/admin` para as páginas que exigem renderização JavaScript ou quando a leitura direta falhar. Nunca enviar chaves ao navegador ou colocar segredos no GitHub.
4. A migração é aplicada idempotentemente na primeira execução do monitor quando a conta do banco tem permissão de DDL. Se não tiver, executar `supabase/migrations/20261008_navios_composio.sql` pelo SQL Editor/admin do banco depois das tabelas-base. RLS permanece habilitada nas novas tabelas.
5. Confirmar que o job **já existente** `copalinks-monitor-1-min` no Supabase chama `/api/cron` a cada minuto. O job usa `SUPABASE_CRON_SECRET` no backend e o segredo `copalinks_supabase_cron_secret` no Vault. Ver `GITHUB_VERCEL.md`; não criar outro agendador duplicado.
6. No plano Vercel Hobby, o cron diário de `vercel.json` NÃO é suficiente para monitoramento contínuo com o app fechado. Usar o job Supabase ou outro cron autorizado; Pro/Enterprise pode usar `vercel.pro.json`.
7. Conferir a resposta autenticada de `/api/cron`, sobretudo `navios.fontes`. HTTP 200 significa resposta do endpoint, não prova de leitura ou de exibição no celular. Verificar que as duas fontes têm leitura válida e sem erro; o campo `metodo` identifica `http` direto ou `composio` de reserva.
8. Conferir um aparelho com notificações permitidas e chat não silenciado. A primeira leitura é silenciosa; um aviso aparece quando houver mudança elegível posterior.

Variáveis opcionais:

```text
NAVIOS_MONITOR_MIN=5
NAVIOS_MAX_POR_CICLO=10
```

A periodicidade significa comparação entre leituras: mudanças intermediárias ocorridas entre duas consultas não podem ser reconstruídas. Fontes que mudarem seu formato exigem ajuste dos parsers; o comportamento seguro é preservar a memória e não emitir informações incompletas. Sem dados válidos por HTTP direto ou pela reserva Composio, não há aviso.

## Validação

- Parsers e regras puras: fixtures no formato visível das fontes, sem rede.
- Integração: PostgreSQL local descartável, HTTP/Composio simulados e Push falso. Cobre leitura direta com reserva, duas fontes independentes, limite estrito, um navio por mensagem, decimais intactos, previsões com berço, repetição, concorrência e nova tentativa por aparelho.
- Regressões: fila pessoal com o app fechado, silêncio do chat, envio HTTPS local cifrado, clima/radar silenciosos e orientações disponíveis para perguntas.
- Nenhuma chave Composio de produção foi usada; a leitura real das páginas e o funcionamento da reserva Composio na conta do proprietário, além da entrega a celulares reais, precisam ser confirmados após o deploy.

Para integração local, criar um PostgreSQL **descartável** cujo nome começa com `fila_push_test_` e passar a mesma URL às duas variáveis:

```bash
DATABASE_URL=postgresql://USUARIO@127.0.0.1:5432/fila_push_test_navios \
TEST_DATABASE_URL=postgresql://USUARIO@127.0.0.1:5432/fila_push_test_navios \
npx tsx --test tests/navios-aviso.test.ts
```

Nunca executar esses testes em banco de produção. Sem essas variáveis, os testes de banco são pulados intencionalmente.
