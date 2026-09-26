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
| **Chat dos motoristas** | recados sobre o trabalho, com atalhos de uso no pátio |
| **Serviços** | links: login do aplicativo, tela de caminhões, APPA, SINPRAPAR |
| **Configurações de API** (`/admin`) | API Keys cifradas, testes de conexão e auditoria |

## Tecnologia

- **Next.js (App Router) + TypeScript + Tailwind CSS**
- **PostgreSQL** com Drizzle ORM
- **Web Push** (`web-push`, VAPID) com Service Worker próprio
- **Leitura do site monitorado**: `intranet.copadubo.com.br/ponto/` (3 quadros,
  6 tabelas), com reserva via **Composio**
- Clima: **APPA/SIMPORT** + Open-Meteo, com reserva via Composio

## Rodar localmente

```bash
cp .env.example .env        # preencha DATABASE_URL
npm install
npx drizzle-kit push        # cria as tabelas
npm run dev
```

## Publicar na Vercel

Veja o passo a passo detalhado em [DEPLOY.md](./DEPLOY.md).

Em resumo:
1. Conecte o repositório na **Vercel** (`vercel.com`).
2. Adicione um banco de dados em **Storage → Create Database → Postgres** (Neon, gratuito).
3. Clique em **Deploy**. O app auto-inicializa as tabelas na primeira requisição!

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `DATABASE_URL` | sim | conexão do PostgreSQL |
| `SITE_URL` | não | endereço público fixo (usado nos links de compartilhar) |
| `SECRETS_MASTER_KEY` | não | chave mestra das API Keys do painel |
| `ADMIN_SETUP_CODE` | não | código para criar o primeiro administrador |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | não | chaves de notificação (o app gera e guarda no banco) |

Segredos (Composio, WhatsApp, IA) são cadastrados em `/admin`, ficam
**cifrados no banco** e nunca são enviados ao navegador.

## Estrutura

```
src/app        rotas e páginas (/, /tempo, /frete, /contatos, /admin, /api)
src/components telas (início, tempo, frete, chat, admin)
src/lib        monitoramento do ponto, push, clima, integrações
scripts        exportar/importar o banco
```


## Push em segundo plano
A réplica usa servidor + VAPID + Service Worker. Para notificações com a interface fechada, configure o `/api/cron` para rodar aproximadamente a cada minuto e defina `CRON_SECRET`. Consulte `GITHUB_VERCEL.md`.
