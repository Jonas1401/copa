# CopaLinks — envio para GitHub/Vercel

## O projeto está pronto

Esta pasta é a **raiz do projeto**. Não entre em outra subpasta antes de enviar.

Arquivos importantes na raiz:
- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `vercel.json`
- `.env.example`
- `src/`
- `public/`

## GitHub pelo navegador

O GitHub não transforma um `.zip` em repositório automaticamente. Se estiver usando o navegador:
1. Crie um repositório vazio no GitHub.
2. Abra `Add file` → `Upload files`.
3. Envie **o conteúdo desta pasta**, mantendo `package.json`, `src`, `public` etc. na raiz do repositório.
4. Faça o commit.

Se o celular não permitir selecionar uma pasta inteira, use um computador ou GitHub Codespaces/uma ferramenta Git para enviar a pasta. **Não envie somente o arquivo ZIP para a raiz**, pois a Vercel não vai tratá-lo como código-fonte do Next.js.

## Vercel

Depois de o repositório estar no GitHub:
1. Importe o repositório na Vercel.
2. Não altere o Framework Preset: Next.js.
3. Cadastre as variáveis de `.env.example` que você realmente usar.
4. Configure `DATABASE_URL`.
5. Para o monitoramento fechado funcionar com baixa latência, configure o Cron da Vercel para chamar `/api/cron` aproximadamente a cada minuto. O `vercel.json` desta versão usa `*/1 * * * *`.
6. Defina `CRON_SECRET` e use o mesmo segredo quando necessário.

## Notificações com o aplicativo fechado

O fluxo é servidor → `/api/cron` → monitoramento → Web Push → `public/sw.js` → notificação do Android/Chrome.

A página não precisa ficar aberta para o servidor disparar o Push. O usuário ainda precisa permitir notificações no navegador/sistema.

## Variáveis mínimas

```text
DATABASE_URL=...
CRON_SECRET=...
```

O restante pode ser configurado depois no painel/admin conforme as integrações usadas.

## Importante

Não coloque `.env` real no GitHub. O repositório contém apenas `.env.example`.
