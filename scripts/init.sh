#!/bin/bash
set -Eeuo pipefail
export SERVER_FILES="${SERVER_FILES:-/home/steam/server-files}"
export PUID="${PUID:-1000}" PGID="${PGID:-1000}"
python3 /home/steam/server/config.py --check
if [[ "$(uname -m)" != x86_64 ]]; then
    echo 'The game requires an x86_64 Linux host; native ARM is unsupported.' >&2
    exit 1
fi
usermod -o -u "$PUID" steam
groupmod -o -g "$PGID" steam
mkdir -p "$SERVER_FILES" /backups
chown steam:steam /home/steam "$SERVER_FILES" /backups
# Repair files created by earlier upstream versions as root.
find "$SERVER_FILES" /backups -xdev \( ! -uid "$PUID" -o ! -gid "$PGID" \) -exec chown -h steam:steam {} +
exec gosu steam /home/steam/server/start.sh
