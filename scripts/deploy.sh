#!/bin/bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -m)" == x86_64 ]] || { echo 'Use an x86_64 Linux host; ARM emulation is unsupported.' >&2; exit 1; }
[[ -f .env ]] || { echo 'Copy .env.example to .env and configure the required values first.' >&2; exit 1; }
docker compose config --quiet
# Rebuild reviewed local source and refreshed OS packages. Never blindly execute a git pull.
docker compose build --pull --no-cache
docker compose up -d --wait --wait-timeout 1200
