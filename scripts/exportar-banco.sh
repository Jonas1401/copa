#!/usr/bin/env bash
# Exporta TODO o banco do CopaLinks para um arquivo (motoristas, pontos, chat,
# chaves cifradas, administrador, histórico).
#   ./scripts/exportar-banco.sh copalinks-2026-09-23.dump
set -euo pipefail
DESTINO="${1:-copalinks.dump}"
URL="${DATABASE_URL:?Defina DATABASE_URL, ex.: postgresql://user:senha@host:5432/copalinks}"
pg_dump --format=custom --no-owner --no-privileges --dbname="$URL" --file="$DESTINO"
echo "Banco exportado em $DESTINO ($(du -h "$DESTINO" | cut -f1))"
