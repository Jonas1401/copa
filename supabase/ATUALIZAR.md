# Atualizar o Supabase (esquema completo)

O app não usa a API REST do Supabase: o backend acessa o **PostgreSQL direto**
(Drizzle + `DATABASE_URL`). Por isso "atualizar o Supabase" aqui significa
**deixar o banco com todas as tabelas, colunas, índices e restrições** que o
código atual espera — sem apagar nenhum dado.

## 1. Jeito mais rápido: um arquivo só

1. Abra o projeto no **Supabase → SQL Editor → New query**.
2. Cole **todo** o conteúdo de
   [`supabase/migrations/20261106_atualizacao_completa.sql`](./migrations/20261106_atualizacao_completa.sql).
3. Clique em **Run**.
4. No fim ele mostra a lista de tabelas criadas/existentes (devem aparecer 52).

O arquivo é **100% idempotente** (`IF NOT EXISTS` / `IF EXISTS` em tudo):

- pode ser executado de novo sempre que quiser, sem erro e sem duplicar nada;
- só **adiciona**: não altera tipo, não apaga coluna e não mexe em dados;
- roda dentro de `BEGIN … COMMIT` — se algo falhar, nada é aplicado pela metade;
- no fim fecha tudo para o `anon`/`authenticated` (RLS + `REVOKE`): o banco só é
  lido pelo backend, nunca pelo navegador.

### O que esse arquivo cobre

| Bloco | Tabelas |
| --- | --- |
| Fila e operação | `pontos`, `amostras`, `eventos` |
| Motoristas | `motoristas` (com `ultimo_acesso_em`), `motorista_sessoes`, `alertas_motorista`, `regras_envios` |
| Notificações push | `subscriptions`, `testes_push`, `notificacoes`, `push_entregas` |
| Configuração e admin | `configuracao`, `admins`, `admin_sessoes`, `segredos`, `integracoes_status`, `auditoria` |
| Chat | `chat_mensagens` (tipo/mídia/duração), `chat_reacoes`, `chat_silenciados` |
| Figurinhas | `figurinha_categorias`, `figurinhas_catalogo` |
| Assistente IA | `ia_mensagens` (com `imagem_dados`) |
| Monitor WhatsApp (Android) | `monitor_codes`, `monitor_pair_codes`, `monitor_devices`, `monitor_messages`, `monitor_deliveries` |
| Navios / clima | `navios_monitor_fontes`, `navios_monitor_eventos`, `navios_avisos`, `clima_mudancas` |
| Banner do motorista | `banners_motorista`, `banner_fontes` |
| Portal do motorista | `portal_motorista_acessos` (CPF/senha cifrados), `portal_leituras` (leitura + diagnóstico), `portal_eventos` (avisos de saída/dispensa), `portal_saidas_pendentes` (saídas aguardando a consulta ao portal), `portal_situacoes` (situação de cada ponto no portal: ATIVO / ESCALADO / EM DISPENSA), `portal_fila` (a fila geral lida na aba “Fila”), `portal_ticket_config` (a porcentagem de cada motorista na Consulta de Ponto) e `portal_tickets` (as viagens da semana lidas na aba “Ticket”) |
| Internet/eSIM | `esim_users`, `esim_plans`, `esim_orders`, `esim_payments`, `esims`, `esim_usage`, `esim_topups`, `esim_webhook_events`, `esim_api_errors`, `esim_settings` |

As migrações antigas (`monitor.sql`, `20261008_navios_composio.sql`,
`20261015_motorista_ultimo_acesso.sql`, `20261019_figurinhas.sql`) continuam
válidas, mas **não precisam mais ser rodadas**: tudo o que elas criam está
incluído no arquivo novo.

## 2. Preciso rodar isso?

Normalmente **não**. Na primeira abertura depois de cada deploy o app chama
`garantirTabelas()` e cria/migra o que falta sozinho (e também cria o schema do
eSIM, o dos navios e a coluna de imagem da IA). Se a conta da `DATABASE_URL`
tem permissão de DDL, o banco se atualiza sem ninguém tocar em nada.

Rode o SQL na mão quando:

- apareceu um erro de "column … does not exist" / "relation … does not exist";
- o usuário do banco perdeu permissão de criar tabela;
- você quer atualizar o banco **antes** do deploy (sem depender da primeira
  requisição) ou revisar exatamente o que vai mudar.

## 3. Confira como está hoje

Com uma `DATABASE_URL` (de preferência a do projeto), rode:

```bash
npm run db:checar
```

O script compara o banco com `src/db/schema.ts` e lista qualquer tabela, coluna,
`UNIQUE` ou índice faltando. Ele **não altera nada** (só lê). Se apontar
problema, rode o SQL do passo 1 e execute o script de novo.

Se o banco estiver vazio/novo e você quiser testar a migração do zero, use um
banco **descartável** com `--recriar` (o script apaga o schema `public` antes):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/copalinks_teste npm run db:checar -- --recriar
```

⚠️ Nunca use `--recriar` no Supabase de produção.

## 4. Segurança do que já existe

- Tudo o que o app cria fica com **RLS habilitada e sem policy**: mesmo que
  `NEXT_PUBLIC_SUPABASE_*` vaze, o navegador não lê nem escreve tabela nenhuma.
- A `DATABASE_URL` (com senha) fica **só na Vercel**, como variável de ambiente
  do servidor. Veja [SUPABASE.md](./SUPABASE.md) para pegar a string de conexão
  e [GITHUB_VERCEL.md](./GITHUB_VERCEL.md) para o cron do Supabase.
