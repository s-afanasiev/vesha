#!/usr/bin/env bash
# Первичная настройка edge-зоны: Caddy + статика + firewall.
# Запускается на сервере от root. Идемпотентен: повторный запуск не ломает
# уже настроенное и не перезаписывает существующий index.html.
#
#   DOMAIN=xn--80adj0f.xn--p1ai EMAIL=admin@example.com bash setup.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:-xn--80adj0f.xn--p1ai}"
EMAIL="${EMAIL:-admin@example.com}"
ROOT="${ROOT:-/srv/vesha/www}"
SSH_PORT="${SSH_PORT:-22}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "запускать от root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> пакеты"
apt-get update
apt-get install -y curl gnupg debian-keyring debian-archive-keyring \
  apt-transport-https ufw fail2ban ca-certificates

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> репозиторий Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> каталоги"
mkdir -p "$ROOT/landing" "$ROOT/projects"

if [ ! -f "$ROOT/landing/index.html" ]; then
  cat > "$ROOT/landing/index.html" <<'HTML'
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vesha</title>
<style>
  body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:38rem;margin:18vh auto;padding:0 1.25rem;color:#1f1f1f}
  h1{font-size:2rem;margin:0 0 .75rem}
  p{color:#666;margin:0}
</style>
</head>
<body>
  <h1>Vesha</h1>
  <p>Сайт собирается. Скоро здесь будет витрина проектов.</p>
</body>
</html>
HTML
fi

chmod -R a+rX "$ROOT"

echo "==> Caddyfile"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__EMAIL__|$EMAIL|g" \
  "$HERE/Caddyfile" > /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> firewall"
ufw allow "$SSH_PORT"/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

systemctl enable --now fail2ban

echo
echo "готово: https://$DOMAIN"
echo "проверка: curl -sS https://$DOMAIN/healthz"
