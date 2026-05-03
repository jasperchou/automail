#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ "${1:-}" = "--with-postgres" ]; then
  exec docker compose -f compose.yml -f compose.postgres.yml up -d --build
fi

exec docker compose up -d --build app
