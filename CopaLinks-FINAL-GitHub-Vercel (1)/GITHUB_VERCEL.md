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

### Cron externo

Se estiver usando Hobby, mantenha o `vercel.json` como está para não impedir o
deploy e configure um serviço de cron externo para chamar:

```text
https://SEU-DOMINIO.vercel.app/api/cron
```

Método: `GET`
Cabeçalho:
`Authorization: Bearer SEU_CRON_SECRET`
Frequência recomendada: **1 minuto**.

### Teste

Com o app instalado e as notificações permitidas, feche a aba/app e altere a
fila monitorada. O cron deve executar a varredura e o Web Push será entregue
ao Service Worker, que chama `showNotification()` sem depender da página estar\n aberta.

### Se você usar Vercel Pro/Enterprise

Já deixei `vercel.pro.json` no projeto. Antes do deploy, renomeie/substitua `vercel.json` por esse arquivo. Ele configura o `/api/cron` a cada minuto.
