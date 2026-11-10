#!/usr/bin/env bash
# Первичная установка edge-зоны: копирует deploy/edge на сервер и запускает setup.sh.
# Запускается с локальной машины.
#
#   HOST=203.0.113.10 SSH_KEY=~/.ssh/vesha-edge ./bootstrap.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST=${HOST:?задайте HOST=<ip или домен>}
SSH_USER=${SSH_USER:-root}
SSH_PORT=${SSH_PORT:-22}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/vesha-edge}
DOMAIN=${DOMAIN:-xn--80adj0f.xn--p1ai}
EMAIL=${EMAIL:-}

SSH_OPTS=(-p "$SSH_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

echo "→ установка edge на $SSH_USER@$HOST (домен $DOMAIN)"

tar -czf - -C "$HERE" . \
  | ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" \
      "rm -rf /tmp/vesha-edge && mkdir -p /tmp/vesha-edge \
       && tar -xzf - -C /tmp/vesha-edge \
       && DOMAIN='$DOMAIN' EMAIL='$EMAIL' SSH_PORT='$SSH_PORT' bash /tmp/vesha-edge/setup.sh"
