#!/usr/bin/env bash
# Публикация статики на edge-сервер. Запускается с локальной машины.
#
#   HOST=203.0.113.10 SSH_KEY=~/.ssh/vesha-edge ./publish.sh ../dist/showcase
#
# Аргументы:
#   $1 — локальный каталог (то, что должно лежать в корне сайта)
#   $2 — удалённый каталог (по умолчанию /srv/vesha/www/landing)
#
set -euo pipefail

SRC=${1:?usage: publish.sh <local-dir> [remote-dir]}
DEST=${2:-/srv/vesha/www/landing}

HOST=${HOST:?задайте HOST=<ip или домен>}
SSH_USER=${SSH_USER:-root}
SSH_PORT=${SSH_PORT:-22}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/vesha-edge}

[ -d "$SRC" ] || { echo "нет каталога: $SRC" >&2; exit 1; }

SSH_OPTS=(-p "$SSH_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

echo "→ $SRC → $SSH_USER@$HOST:$DEST"

tar -czf - -C "$SRC" . \
  | ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" \
      "rm -rf '$DEST' && mkdir -p '$DEST' && tar -xzf - -C '$DEST' && chmod -R a+rX '$DEST'"

echo "готово"
