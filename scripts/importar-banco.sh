#!/usr/bin/env bash
# Importa o banco exportado pelo exportar-banco.sh no servidor novo.
#   ./scripts/importar-banco.sh copalinks-2026-09-23.dump
set -euo pipefail
ARQUIVO="${1:?Informe o arquivo .dump exportado}"
URL="${DATABASE_URL:?Defina DATABASE_URL do banco novo}"
# Limpa as tabelas antes (o dump traz os dados completos)
psql --dbname="$URL" -c "drop schema if exists public cascade; create schema public;"
pg_restore --no-owner --no-privileges --dbname="$URL" "$ARQUIVO"
echo "Banco importado."
