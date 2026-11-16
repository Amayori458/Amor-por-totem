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

## Instalar no seu servidor (Docker)

O `docker-compose.yml` sobe três serviços: o app, um Postgres local (os dados ficam no servidor) e o Tailscale, que dá um endereço HTTPS público do tipo `https://financas.<sua-rede>.ts.net` — sem domínio próprio e sem abrir portas no roteador.

**Uma vez, no site do Tailscale** (conta gratuita em https://login.tailscale.com):

1. **DNS** → ative **MagicDNS** e **HTTPS Certificates**.
2. **Access controls** → adicione ao arquivo de políticas: `"nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]`.
3. **Settings → Keys** → **Generate auth key** e copie a chave (`tskey-auth-...`).

**No servidor:**

```bash
git clone https://github.com/Amayori458/Amor-por-totem.git
cd Amor-por-totem/financas
./instalar.sh        # pede a chave do Tailscale, gera as senhas no .env e sobe tudo
docker compose exec tailscale tailscale funnel status   # mostra o endereço https público
```

O script mostra a senha de entrada do app. Abra o endereço `https://…ts.net` no Safari do iPhone → Compartilhar → **Adicionar à Tela de Início**, e siga a aba **Automação**.

| Tarefa | Comando |
|---|---|
| Atualizar | `git pull && ./instalar.sh` |
| Ver logs | `docker compose logs -f app` |
| Backup | `docker compose exec db pg_dump -U financas financas > backup.sql` |
| Restaurar | `docker compose exec -T db psql -U financas financas < backup.sql` |
| Ver senha e token | `cat .env` |

Sem chave do Tailscale o app funciona só no próprio servidor (`http://localhost:3002`).

### Alternativa: Vercel + Supabase

Importe o repositório na Vercel com **Root Directory = `financas`** e defina `DATABASE_URL` (connection string “Transaction pooler” do Supabase), `APP_PASSWORD` e `INGEST_TOKEN`.

## Segurança

Uso individual: uma senha (`APP_PASSWORD`) abre o app, com sessão em cookie `HttpOnly` assinado; o Atalho usa um token separado (`INGEST_TOKEN`) que só consegue **criar** lançamentos. Trocar qualquer um dos dois invalida as sessões abertas.
