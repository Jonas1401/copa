# Checklist GitHub + Vercel

## GitHub

```bash
git init
git add .
git commit -m "feat: initial CopaLinks replica"
git branch -M main
git remote add origin SEU_REPOSITORIO_GITHUB
git push -u origin main
```

Não envie `.env`, dumps do banco, `node_modules` ou `.vercel`.

## Vercel

1. Importe o repositório no painel da Vercel.
2. Framework: Next.js (detecção automática).
3. Conecte um PostgreSQL compatível com a variável `DATABASE_URL`.
4. Em **Settings → Environment Variables**, configure pelo menos `DATABASE_URL`.
5. Defina `ADMIN_SETUP_CODE` com um valor aleatório de 8+ caracteres.
6. Se quiser criação automática do usuário `admin`, defina também `ADMIN_PASSWORD`.
7. Faça o deploy.
8. Abra `/admin` e crie/acesse o administrador.

## Integrações opcionais

As chaves de Composio, WhatsApp e IA podem ser cadastradas no próprio `/admin`. Elas ficam cifradas no banco quando a chave mestra está configurada.

## Monitoramento externo

A rota `/api/cron` pode ser chamada por um serviço externo de cron a cada minuto para manter o monitoramento ativo mesmo quando nenhum navegador estiver aberto. A Vercel Hobby não deve ser tratada como um cron de alta frequência.

## 🔔 Push com o aplicativo fechado

A versão desta réplica corrige o problema em que as notificações só eram
disparadas enquanto a página estava aberta. O navegador continua apenas
recebendo o Push; a **verificação da fila agora acontece no servidor** pela
rota `/api/cron`.

### Vercel

Para monitoramento automático em torno de 1 minuto, use um plano da Vercel
que permita cron por minuto e altere `vercel.json` para:

```json
"crons": [{ "path": "/api/cron", "schedule": "*/1 * * * *" }]
```

Na Vercel, crie também:

```text
CRON_SECRET=uma-senha-secreta-grande
```

A Vercel envia esse segredo automaticamente no cabeçalho `Authorization` do
Cron Job. O plano Hobby atualmente mantém Cron Jobs com execução diária; para
execução por minuto, use Pro/Enterprise ou um serviço externo de cron.

### Supabase Cron no plano Hobby (configuração do projeto oficial)

O projeto `copa-links` roda no plano Hobby, onde `vercel.json` só pode chamar
`/api/cron` uma vez ao dia. Para continuar monitorando com a interface fechada,
**Supabase pg_cron + pg_net** chama a mesma rota **a cada minuto**. Os dois
agendadores são independentes: o da Vercel usa `CRON_SECRET`; o do Supabase
usa `SUPABASE_CRON_SECRET`. A rota só executa quando recebe um dos dois valores
válidos em `Authorization: Bearer ...`.

No Supabase, habilite as extensões `pg_cron` e `pg_net` (se necessário). Guarde
no **Supabase Vault** um segredo de nome `copalinks_supabase_cron_secret` cujo
valor é o mesmo de `SUPABASE_CRON_SECRET` da Vercel. Configure esse valor no
painel das respectivas plataformas; **não coloque o segredo no SQL, no GitHub,
nem na URL da requisição**. O comando do job referencia só o nome no Vault:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'copalinks-monitor-1-min',
  '* * * * *',
  $$
    select net.http_get(
      url := 'https://copa-links.vercel.app/api/cron',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret
                     from vault.decrypted_secrets
                     where name = 'copalinks_supabase_cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);
```

Confira a execução (sem ler os valores do Vault):

```sql
select jobid, jobname, schedule, active
from cron.job where jobname = 'copalinks-monitor-1-min';

select status_code, created
from net._http_response
order by id desc limit 5;
```

Resposta HTTP **200** significa que `/api/cron` respondeu; confira também `navios.fontes`
na resposta para validar as leituras do Composio. Um 200 não garante que uma fonte
foi lida nem que o celular exibiu uma notificação; **401** significa
chave ausente ou diferente. Para interromper o job sem apagar dados do app:
`select cron.unschedule('copalinks-monitor-1-min');`

### Cron externo como alternativa

Se o Supabase Cron não estiver disponível, um serviço externo também pode
chamar `https://copa-links.vercel.app/api/cron` a cada minuto com método GET
e cabeçalho `Authorization: Bearer SEU_CRON_SECRET`. Nunca ponha a chave na URL.

### Teste de notificação no celular

**Botão pronto no painel do administrador:** `/admin` → card **Notificações**
→ **Testar com o app fechado** (o mesmo card também ativa as notificações e faz
o teste imediato no aparelho em uso; os motoristas veem só **Ativar
notificações**, na aba Sobre). O botão só agenda o teste (tabela `testes_push`); você fecha o app e
quem envia é o próximo ciclo de leitura do `/api/cron` (pelo menos 20 s depois
do toque, para dar tempo de fechar), com a posição atualizada do ponto — o
mesmo caminho dos avisos de chamada. Ao reabrir o app, ele mostra se o servidor
enviou e a que horas. A resposta do `/api/cron` inclui `testes` quando algum
teste saiu naquele ciclo.

Teste manual (sem o botão): com o app instalado e as notificações permitidas,
feche a aba/app e aguarde a próxima varredura. Quando houver uma mudança no ponto cadastrado, o servidor
dispara o Web Push. O Service Worker chama `showNotification()` sem a página
estar aberta. O cron pode ser testado sem enviar Push simulando mudanças no
banco (consulte `cron.job_run_details` e `net._http_response`); a entrega real
ao celular depende de um navegador inscrito e de uma mudança real na fila.

### Se você usar Vercel Pro/Enterprise

Já deixei `vercel.pro.json` no projeto. Antes do deploy, renomeie/substitua
`vercel.json` por esse arquivo para executar `/api/cron` a cada minuto na Vercel,
sem necessidade de manter o job `copalinks-monitor-1-min` no Supabase.
