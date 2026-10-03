# CopaLinks · Internet / eSIM (piloto privado)

A área está dentro do painel autenticado `/admin` e **não foi adicionada à home, à navegação dos motoristas ou a uma rota de cliente**. Os endpoints de leitura/gestão são `/api/admin/esim/*` e exigem a sessão do administrador. O único endpoint sem sessão é o callback NexaEsim, validado por HMAC antes de ler o JSON.

## Documentação consultada

Documentação oficial NexaEsim Partner API v1: <https://nexaesim.com/partner/api-docs> (consultada em 03/10/2026).

- Base de produção publicada: `https://nexaesim.com/api/partner/v1`.
- API de comércio: `X-API-Key`, endereço IP do servidor na allowlist, JSON/HTTPS.
- A documentação pública consultada **não publica base URL nem procedimento de sandbox**. Por isso `NEXAESIM_MODE=TEST` não faz requisições externas. O catálogo e a aprovação de pagamento de teste são fixtures locais claramente identificadas como fictícias; não criam perfil instalável.
- Há um link “View API documentation” no portal parceiro, mas os dados de conta, allowlist, chave e materiais específicos do sandbox dependem do acesso aprovado ao portal.

### Endpoints de comércio usados/preparados (somente os publicados)

| Método | Path documentado | Uso no CopaLinks |
| --- | --- | --- |
| POST | `/package/load` | Consulta e sincroniza catálogo; a resposta publicada inclui `wholesalePrice`, `retailPrice`, dados e duração. A listagem de pacotes ativos é usada como disponibilidade de catálogo. |
| POST | `/package/coverage` | Endpoint documentado; reservado para mapear cobertura adicional quando o schema recebido/necessário estiver definido. |
| POST | `/order/create` | Só pode ser chamado pelo backend após pagamento confirmado. Envia `orderItems`, `callbackUrl` HTTPS e `X-Idempotency-Key`. |
| POST | `/order/query` | Consultar status por `orderCode`. |
| POST | `/sim-info/load` | Preparado; recebe `email` e `orderCode`. O endpoint está documentado, mas a estrutura de resposta pública não está descrita. |
| POST | `/sim-info/query-info` | A consulta é chamada no backend. Como a documentação pública não define campos/unidades da resposta, o corpo fica fora dos logs/banco/API e GB utilizado não é inferido. |

O adaptador valida o host/base de produção para `nexaesim.com/api/partner/v1`. Em teste, a função recusa chamadas de rede mesmo se uma chave aparecer no ambiente. A API Key e a URL nunca são enviadas ao navegador; o endpoint administrativo devolve apenas indicadores de presença/configuração.

## Segredos do backend

Configurar em **Vercel → Settings → Environment Variables** (ou no ambiente privado do servidor), nunca em `NEXT_PUBLIC_*`, HTML, APK, Git, respostas ou logs:

```text
NEXAESIM_MODE=TEST
NEXAESIM_API_KEY=
NEXAESIM_API_URL=https://nexaesim.com/api/partner/v1
NEXAESIM_WEBHOOK_SECRET=
ESIM_PAYMENT_WEBHOOK_SECRET=
```

`NEXAESIM_MODE` aceita `TEST` ou `PRODUCTION`; valor ausente/inválido resulta em TEST. A interface não permite trocar o modo. Só habilitar `PRODUCTION` quando a conta aprovada, segredo de callback, IP allowlist e pagamento estiverem revisados. Não cadastrar credenciais de produção durante o desenvolvimento.

O endpoint público Nexa é `POST /api/esim/webhook`. A documentação exige `Signature` = HMAC-SHA256 hexadecimal maiúsculo do **corpo UTF-8 exato**. A aplicação valida com comparação de tempo constante antes do `JSON.parse`. Usa SHA-256 do corpo como chave única do evento, salva o callback em estado pendente somente se o `orderCode` ainda não estiver associado, e remove o payload após processar. A listagem administrativa nunca devolve o payload/QR do webhook. ICCID, QR, URL e eventual código de ativação ficam na linha de eSIM e só o endpoint de detalhe autenticado do administrador retorna esses dados.

O callback é idempotente. Atualiza status de pedido documentado (1, 2, 3, 4, 5, 6, 11, 12), ICCID, QR/QR URL, URL de instalação, `smDp`, status bruto, e `expiredTime`. O código numérico de status individual de SIM é mostrado sem interpretação porque a documentação pública não define seus valores. Uma chamada de `order/create` persiste primeiro uma chave idempotente e a URL de callback snapshot; retries usam o mesmo corpo/chave. Erros guardam só request ID, operação, HTTP e código de erro — nunca headers/corpo.

## Pagamentos e fluxo de compra

O repositório CopaLinks não tinha um gateway Pix/cartão instalado ou configurado. Não foi inventado endpoint de gateway nem criado checkout público.

- TESTE: `/admin` permite criar um pedido e simular confirmação local. A simulação **não cobra**, **não chama a NexaEsim** e **não gera eSIM/QR instalável**.
- PRODUÇÃO: pedido não pode ser criado pela interface de teste. O serviço só chama `/order/create` depois que `esim_payments.status = PAID`; o evento vem de webhook assinado e confere valor/moeda com o registro local. Falha da Nexa deixa o pagamento confirmado e permite reenvio administrativo em `/api/admin/esim/orders/:id/retry`, reutilizando a mesma idempotency key e sem cobrar de novo. Transições de callback/query são serializadas e estados atrasados não desfazem uma conclusão.
- `/api/esim/payment-webhook` implementa um **contrato normalizado do CopaLinks**, não um adaptador de um provedor específico. HMAC no header `Signature` com `ESIM_PAYMENT_WEBHOOK_SECRET`; JSON esperado:

```json
{
  "eventId": "id-unico-do-gateway",
  "orderId": 123,
  "paymentId": "referencia-do-pagamento",
  "status": "paid",
  "amount": "9.99",
  "currency": "USD",
  "method": "pix"
}
```

`status` aceito: `paid`, `failed`, `cancelled`, `refunded`; `method` opcional: `pix` ou `card`. O gateway real precisa de um adaptador que verifique a assinatura nativa dele e traduza o evento para esse contrato antes de habilitar produção. A configuração atual **não cria charge, QR Pix, captura de cartão, cancelamento ou reembolso**. Cancelamento/reembolso recebido só atualiza o ledger local; qualquer ação externa precisa do gateway verdadeiro.

A API NexaEsim informa valores em USD. A margem configurável no painel é percentual sobre wholesale, arredondada a centavos. Conversão USD/BRL, impostos e liquidação local não foram inventados; confirme moeda aceita pelo gateway antes de cobrar.

## Banco

O schema Drizzle fica em `src/db/schema.ts`; as tabelas são garantidas pelo backend quando a área é aberta:

- `esim_users` (associação opcional ao `motoristas.id` existente, sem reutilizar uma tabela genérica `users`);
- `esim_plans`, `esim_orders`, `esim_payments`, `esims`, `esim_usage`, `esim_topups`, `esim_webhook_events`;
- `esim_settings` e `esim_api_errors` para margem e erros sanitizados.

Toda consulta da área operacional é protegida por `exigirAdmin()`. Ainda não existem endpoints de cliente, portanto nenhuma sessão de motorista recebe lista/QR de terceiros; a exposição está restrita ao painel administrativo durante o teste.

## Limites oficiais pendentes — não inferir

1. **Sandbox**: NexaEsim precisa fornecer base URL, procedimento/credenciais de teste e assinatura de callbacks de teste. A documentação pública v1 consultada só informa base de produção.
2. **Pagamento**: indicar qual gateway existente deve ser usado (Pix/cartão), suas credenciais de sandbox e documentação de charge, confirmação, cancelamento e reembolso; implementar o adapter nativo e configurar `ESIM_PAYMENT_WEBHOOK_SECRET`.
3. **Moeda**: definir preço/FX de USD para a moeda liquidada pelo gateway e regras fiscais.
4. **Consumo**: confirmar schema da resposta de `/sim-info/query-info`, unidade, remaining/used e datas, para preencher GB usados/disponíveis.
5. **Saldo**: o Account API lista `GET /account`/`GET /wallet` com Bearer token de `/auth/login`, separado da API Key de comércio; é necessário acesso e schema de retorno do saldo antes de mostrar o valor.
6. **Recarga de perfil**: a documentação pública não publica endpoint de top-up de eSIM. `/wallet/topups` é recarga da carteira do parceiro, não do perfil do cliente. O botão e o endpoint local retornam 501 sem chamada/cobrança.
7. **Instalação**: callback documenta QR, `qrUrl`, `installationUrl`, ICCID, `smDp`, validade. Código de ativação separado não consta no exemplo; só aparece se a resposta futura o enviar. O guia oficial orienta instalação manual; não há método universal de instalação automática para todos os aparelhos documentado pela Nexa.
8. **Entrega**: testar o formato real de `order/create`, `/order/query` e `/sim-info/load` no sandbox aprovado; o mapper usa somente campos explicitamente mostrados na documentação pública.

## Verificações

```bash
npm run typecheck
npm run lint
./node_modules/.bin/tsx --test tests/esim-*.test.ts
```

O teste da integração verifica caminhos oficiais, bloqueio de rede no modo TESTE, autenticação/idempotência com `fetch` mockado, mapeamento de catálogo, HMAC, statuses e margem. Não havia `DATABASE_URL`, gateway, credenciais ou sandbox NexaEsim neste ambiente; portanto nenhum pagamento real, perfil real, callback real ou eSIM instalável foi criado/testado.
