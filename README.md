# Space Pay Gateway

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Foliveora72-coder%2FSpacepay&project-name=spacepay&repository-name=Spacepay)

Gateway brasileira de pagamentos pronta para Vercel, com painel responsivo, API REST, PIX e cartão pelo Mercado Pago, sandbox, webhooks assinados, reembolsos, saques, clientes, links de pagamento e administração.

> O software não transforma uma empresa em instituição de pagamento. Para movimentar dinheiro real, use uma conta Mercado Pago aprovada, cumpra os termos do provedor e valide obrigações jurídicas, fiscais, KYC/AML e LGPD com profissionais qualificados.

## O que já está implementado

- Painel do lojista e painel administrativo em português.
- Cadastro, login, sessão `HttpOnly`, bloqueio após tentativas e senhas com `scrypt`.
- API keys de teste/produção com hash, escopos e revogação.
- Cobranças PIX e cartão pela Orders API atual do Mercado Pago.
- Sandbox explícito, sem movimentar dinheiro real.
- Idempotência obrigatória em criação e reembolso.
- Webhook Mercado Pago com validação `x-signature` e deduplicação.
- Webhooks dos lojistas assinados, com fila, tentativas e backoff.
- Clientes, links de pagamento, reembolsos e solicitações de saque.
- Taxa percentual + taxa fixa, saldos disponível/pendente/reservado.
- Regras de risco, trilha de auditoria e painel de KYC.
- Valores monetários guardados em centavos e operações críticas atômicas no PostgreSQL.
- Headers de segurança e nenhuma coleta direta de número/CVV de cartão.

## Arquitetura

- Frontend: SPA estática sem dependências, em `index.html`, `styles.css` e `app.js`.
- Backend: Vercel Function em Node.js, em `api/index.js`.
- Banco: PostgreSQL via Supabase/PostgREST.
- Provedor: `sandbox` ou Mercado Pago Orders API `/v1/orders`.
- Esquema: `database/schema.sql`.

Não existem pacotes npm de produção; o projeto é pequeno, rápido e não depende de build.

## Configuração rápida

### 1. Banco

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Execute todo o arquivo `database/schema.sql`.
4. Copie a URL do projeto e a chave `service_role`.

A chave `service_role` nunca pode ser colocada no frontend nem enviada ao GitHub.

### 2. Mercado Pago

1. Crie uma aplicação em **Suas integrações** no Mercado Pago.
2. Cadastre uma chave PIX na conta vendedora.
3. Comece com credenciais de teste.
4. Configure o webhook como:

```text
https://SEU-DOMINIO.vercel.app/api/webhooks/mercado-pago
```

5. Ative eventos de orders/pagamentos e copie o segredo de assinatura.

Cartões devem ser tokenizados no navegador com Mercado Pago.js/Payment Brick. A API recebe somente `card_token`; número, validade e CVV não passam pelo servidor Space Pay.

### 3. Variáveis na Vercel

Copie as chaves de `.env.example` para **Vercel → Project Settings → Environment Variables**. Use valores secretos para:

- `JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `CRON_SECRET`
- `WEBHOOK_SIGNING_SECRET`

Comece com `PAYMENT_PROVIDER=sandbox`. Troque para `mercadopago` somente depois dos testes e da aprovação da conta.

### 4. Primeiro administrador

Defina `ADMIN_EMAIL` antes do primeiro cadastro. A conta criada com esse e-mail recebe papel `admin`. Os demais cadastros recebem papel `merchant`.

## API

Base URL:

```text
https://SEU-DOMINIO.vercel.app/api
```

Criar uma cobrança PIX:

```bash
curl -X POST 'https://SEU-DOMINIO.vercel.app/api/v1/charges' \
  -H 'Authorization: Bearer sp_test_SUA_CHAVE' \
  -H 'X-Idempotency-Key: pedido-1001' \
  -H 'Content-Type: application/json' \
  -d '{
    "external_reference": "pedido-1001",
    "amount": 49.90,
    "method": "pix",
    "payer": {"name": "Ana Silva", "email": "ana@email.com"}
  }'
```

Principais rotas:

| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/auth/register` | Criar lojista e usuário |
| `POST` | `/api/auth/login` | Iniciar sessão |
| `GET/POST` | `/api/v1/charges` | Listar/criar cobranças |
| `GET` | `/api/v1/charges/:id` | Consultar cobrança |
| `POST` | `/api/v1/charges/:id/sync` | Sincronizar com provedor |
| `POST` | `/api/v1/charges/:id/refund` | Reembolsar |
| `GET/POST` | `/api/v1/customers` | Clientes |
| `GET/POST` | `/api/v1/payment-links` | Links de pagamento |
| `GET/POST` | `/api/v1/withdrawals` | Saques |
| `GET/POST` | `/api/v1/api-keys` | Chaves de API |
| `GET/POST` | `/api/v1/webhook-endpoints` | Webhooks do lojista |
| `POST` | `/api/webhooks/mercado-pago` | Notificações do provedor |
| `GET` | `/api/health` | Saúde da aplicação |

## Webhooks enviados ao lojista

Headers:

```text
Spacepay-Event: charge.updated
Spacepay-Timestamp: 1780000000
Spacepay-Signature: t=1780000000,v1=HMAC_SHA256
```

Calcule `HMAC-SHA256(secret, "timestamp.corpo-json-exato")` e compare em tempo constante. Aceite somente timestamps recentes e deduplique pelo `id` do evento.

## Testes

```bash
npm run check
```

O comando verifica a sintaxe e testa senha, sessão, criptografia, valores e taxas sem instalar dependências.

## Produção

Antes de ativar pagamentos reais:

- finalize KYC do Mercado Pago e cadastre a chave PIX;
- configure segredos diferentes e aleatórios;
- use domínio HTTPS próprio;
- teste webhook, idempotência, reembolso e reconciliação;
- defina política de saques e um provedor autorizado para transferências automáticas;
- configure monitoramento, alertas, backups e resposta a incidentes;
- faça revisão de segurança e jurídica independente.

O Mercado Pago processa cobranças, mas este projeto não inventa uma API de transferência que o provedor não oferece. Em produção, saques ficam em revisão até a integração de payout autorizada ser adicionada.
