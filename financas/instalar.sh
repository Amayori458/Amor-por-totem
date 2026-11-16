#!/usr/bin/env bash
# Sobe (ou atualiza) o app de finanças neste servidor. Rode de dentro da pasta financas/.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker não encontrado. Instale com: curl -fsSL https://get.docker.com | sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta o plugin 'docker compose'."; exit 1; }

segredo() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [ ! -f .env ]; then
  echo "Cole a chave de autenticação do Tailscale (tskey-auth-...)."
  echo "Gere em https://login.tailscale.com/admin/settings/keys — ou deixe vazio para usar só na rede local."
  read -r -p "TS_AUTHKEY: " TS_AUTHKEY
  umask 077
  cat > .env <<ENV
POSTGRES_PASSWORD=$(segredo 32)
APP_PASSWORD=$(segredo 14)
INGEST_TOKEN=$(segredo 40)
TS_AUTHKEY=${TS_AUTHKEY}
ENV
  echo "Arquivo .env criado."
fi

docker compose up -d --build

echo
echo "Senha para entrar no app: $(grep '^APP_PASSWORD=' .env | cut -d= -f2-)"
echo "Teste neste servidor:      http://localhost:3002"
echo "Endereço público (HTTPS):  rode  docker compose exec tailscale tailscale funnel status"
