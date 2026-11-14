# Finanças

App pessoal de gestão financeira (PWA instalável no iPhone) que registra sozinho as movimentações do Nubank, Mercado Pago e XP a partir de automações do app **Atalhos** da Apple.

- **Resumo** do mês: saldo, entradas, saídas, gastos por categoria, últimos 6 meses e totais por conta.
- **Lançamentos**: lista por dia, edição, exclusão e fila de revisão para o que o leitor não entendeu bem.
- **Automação**: passo a passo dos Atalhos, com o endereço e o token para copiar.

## Como as notificações entram

O iOS não permite que um app leia notificações de outro. O que funciona:

| Origem | Como | Automático? |
|---|---|---|
| Compras com Apple Pay | Automação “Transação” (Carteira) → `POST /api/ingest` com `merchant`, `amount`, `card` | Sim |
| SMS / e-mail do banco | Automação “Mensagem” / “E-mail” → `POST /api/ingest` com `text` | Sim |
| Notificações push (Pix etc.) | Atalho: captura de tela → extrair texto → `POST /api/ingest` com `text` (ex.: no “Tocar atrás”) | Um toque |
| Qualquer texto | Botão “Colar notificação” dentro do app | Manual |

O servidor (`server/parser.ts`) extrai valor, tipo (entrada/saída/investimento), estabelecimento, conta e categoria. Reenvios da mesma notificação em até 10 minutos são ignorados.

```bash
curl -X POST https://SEU-APP/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"app":"Nubank","text":"Compra de R$ 25,90 APROVADA em PADARIA X para o cartão com final 1234."}'
```

## Rodar localmente

Requer Node 22 e um Postgres.

```bash
cp .env.example .env   # preencha DATABASE_URL, APP_PASSWORD e INGEST_TOKEN
npm install
npm run build
node --env-file=.env --import tsx server/index.ts   # http://localhost:3002
npm test                                            # testes do leitor de notificações
```

As tabelas são criadas automaticamente na primeira requisição.

## Publicar (para usar no iPhone)

O iPhone precisa alcançar o app por HTTPS. Sugestão: **Vercel** (app + API) com Postgres do **Supabase**.

1. Na Vercel, importe este repositório com **Root Directory = `financas`**.
2. Defina as variáveis `DATABASE_URL` (connection string “Transaction pooler” do Supabase), `APP_PASSWORD` e `INGEST_TOKEN` (valor longo e aleatório).
3. Abra o endereço no Safari → Compartilhar → **Adicionar à Tela de Início** e siga a aba **Automação**.

Também roda em qualquer host Node (`npm run build && npm start`).

## Segurança

Uso individual: uma senha (`APP_PASSWORD`) abre o app, com sessão em cookie `HttpOnly` assinado; o Atalho usa um token separado (`INGEST_TOKEN`) que só consegue **criar** lançamentos. Trocar qualquer um dos dois invalida as sessões abertas.
