# Conectar o Supabase ao CopaLinks

Este guia mostra exatamente onde tocar no Supabase para encontrar a
**senha do banco** — a única informação que falta para o app funcionar no
endereço permanente (`copa-links.vercel.app`).

---

## 1. No computador (mais fácil)

1. Abra **supabase.com/dashboard** e entre no seu projeto.
   (Nos painéis mais novos, o caminho mais curto é o botão **Connect**, no topo
   da página do projeto — ele mostra as mesmas strings de conexão.)
2. No menu lateral esquerdo, toque na **engrenagem ⚙** (Project Settings).
3. No meio, toque em **Database**.
4. Desça até o bloco **Connection string**.
5. Toque na aba **URI**.
6. Você verá algo assim:

```
postgresql://postgres:[YOUR-PASSWORD]@db.dhlwytthbnarxwioqhdr.supabase.co:5432/postgres
```

7. **Não cole na conversa** — essa linha contém a senha do banco. Cole direto
   na Vercel: **Settings → Environment Variables → `DATABASE_URL`**.
   - Se aparecer `[YOUR-PASSWORD]` no lugar, troque pela senha que você criou
     quando o projeto foi criado.

---

## 2. Opção recomendada: Connection Pooling (porta 6543)

No mesmo lugar (**Settings → Database → Connection string**), mude para a aba
**Connection pooling** e copie essa versão (porta `6543`). É a que funciona
melhor com a Vercel:

```
postgresql://postgres.dhlwytthbnarxwioqhdr:[SENHA]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

Ambas funcionam — eu detecto sozinho qual é e ajusto o app.

---

## 3. Se você não lembra a senha

1. No mesmo lugar (**Settings → Database**), desça até **Database password**.
2. Toque em **Reset database password**.
3. Copie a senha nova e use-a na `DATABASE_URL` da Vercel (nunca cole a senha na conversa).

⚠️ Isso invalida conexões antigas do próprio Supabase, mas o CopaLinks usa a
nova, então tudo bem.

---

## 4. A tabela "notes" do exemplo: pode ignorar

O código SQL do `create table notes` que o Supabase mostra na tela inicial é
**apenas um exemplo**. Não precisa rodar. O CopaLinks cria as próprias tabelas
(`pontos`, `motoristas`, `subscriptions`...) sozinho na primeira abertura.

---

## 5. Por que a chave pública não serve?

As variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
são para **o app do navegador falar com o Supabase** (tabelas "notes", login de
usuário etc.). Elas **não abrem o banco de dados** — por isso o app não sobe
com elas.

O CopaLinks usa **PostgreSQL direto** (não a API REST do Supabase), então
precisa da **senha do banco**.

---

## 6. O que acontece depois de você colar na Vercel

1. A Vercel guarda a conexão como `DATABASE_URL` no projeto **copa-links**
   (só o servidor enxerga; o navegador nunca recebe esse valor).
2. Faça um novo deploy (**Deployments → ⋯ → Redeploy**).
3. O app cria as tabelas sozinho e sai da tela de espera.
4. Você recebe o link permanente:
   **https://copa-links.vercel.app** — funcionando para sempre.
