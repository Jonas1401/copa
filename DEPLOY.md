# Como publicar o CopaLinks na Vercel (Passo a Passo)

Este guia explica como publicar o **CopaLinks** na **Vercel** com PostgreSQL e configurar o primeiro administrador com segurança.

---

## 1. Subir o código para o GitHub

1. Baixe o pacote zip com o código atualizado do app.
2. No seu repositório no GitHub, crie um repositório vazio e envie o conteúdo desta pasta:
   - Clique em **Add file → Upload files**
   - Arraste os arquivos do projeto descompactados
   - Clique em **Commit changes**

---

## 2. Criar o projeto na Vercel

1. Acesse **[vercel.com](https://vercel.com)** e faça login com sua conta do GitHub.
2. No painel, clique em **Add New... → Project**.
3. Localize o repositório `CopaLinks-` e clique em **Import**.
4. A Vercel detectará automaticamente **Next.js**. Não precisa alterar configurações de build.

---

## 3. Adicionar o banco de dados PostgreSQL (1 clique)

O CopaLinks precisa de um banco PostgreSQL para guardar motoristas, pontos, chat e chaves. A Vercel oferece banco integrado gratuito (Neon):

1. Antes de clicar em Deploy (ou depois no menu do projeto), vá na aba **Storage**.
2. Clique em **Create Database** e selecione **Postgres (Neon)**.
3. Escolha a região **São Paulo, Brazil (gru1)** ou US East.
4. Conecte o banco ao seu projeto CopaLinks.
5. A Vercel injetará automaticamente as variáveis de banco (`DATABASE_URL` e `POSTGRES_URL`).

> **Banco:** ao abrir o app pela primeira vez, ele cria automaticamente as tabelas necessárias. Também é possível usar `npx drizzle-kit push` localmente.

---

## 4. Deploy

1. Clique em **Deploy**.
2. Em cerca de 1 a 2 minutos, seu app estará no ar com link permanente:
   **`https://seu-projeto.vercel.app`**

Esse link **nunca cai** e não expira!

---

## 5. Como adicionar um Domínio Próprio (Opcional)

Se futuramente você quiser usar um domínio próprio (ex.: `www.seudominio.com`):
1. No painel do projeto na Vercel, vá em **Settings → Domains**.
2. Digite o domínio desejado e clique em **Add**.
3. A Vercel mostrará exatamente o registro DNS que deve ser colocado no seu registrador (geralmente um CNAME apontando para `cname.vercel-dns.com`).
4. O certificado SSL HTTPS é gerado automaticamente pela Vercel de graça.

---

## 6. Como levar os dados atuais (Opcional)

Se você quiser migrar os motoristas e pontos existentes para o banco novo na Vercel:
```bash
# Exporta do banco atual
./scripts/exportar-banco.sh copalinks.dump

# Importa no banco novo da Vercel (substitua pela DATABASE_URL da Vercel)
DATABASE_URL="sua-connection-string-da-vercel" ./scripts/importar-banco.sh copalinks.dump
```

---

## 7. Primeiro acesso ao administrador

1. Em **Settings → Environment Variables** da Vercel, crie `ADMIN_SETUP_CODE` com um código aleatório de pelo menos 8 caracteres.
2. Opcionalmente, defina `ADMIN_PASSWORD` com pelo menos 8 caracteres para permitir a criação automática do usuário `admin`.
3. Abra `/admin`. Se não houver administrador, a tela mostrará **Criar administrador**.
4. Depois de entrar, altere a senha e configure as integrações.

**Não existe senha padrão embutida no código desta réplica.**

---

## 8. Radar da previsão: navegador automático e OCR (opcional)

O radar lê o painel da APPA por vários métodos, com fallback automático (API →
HTML → navegador automático → OCR → Composio). **A API da Simport basta para o
dia a dia e não exige nenhuma configuração.** O navegador e o OCR são a rede de
segurança para o dia em que a API mudar, e precisam de um Chromium:

- **Vercel:** nada a fazer — o `@sparticuz/chromium-min` baixa o Chromium na
  primeira leitura que precisar dele. Se preferir um navegador remoto (mais
  rápido e sem download), defina `APPA_BROWSER_WS` (Browserless, Browserbase…).
- **Docker:** a imagem já instala o Chromium (`--build-arg INSTALAR_CHROMIUM=0`
  para não instalar).
- **Servidor próprio:** instale o Chromium e, se necessário, defina
  `APPA_CHROMIUM_PATH`.

No `/admin`, o cartão *Radar da previsão* mostra **Painel APPA: conectado** (ou
**leitura realizada**), o **Método de leitura** e o log de cada tentativa; o botão
**Ler painel agora** confere na hora qual método está funcionando. Veja o `README.md`
(seção *Leitura do painel da APPA*) e o `.env.example` para as variáveis `APPA_*`.
