#!/bin/bash
set -Eeuo pipefail
# shellcheck source=functions.sh
source /home/steam/server/functions.sh
export SERVER_FILES="${SERVER_FILES:-/home/steam/server-files}"
cd "$SERVER_FILES"
STARTUP_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
export STARTUP_AT
progress() { python3 /home/steam/server/progress.py "$1"; }
trap 'progress failed' ERR
if [[ "${UPDATE_ON_START:-true}" == true ]]; then
    progress backing_up
    python3 /home/steam/server/backup.py
    progress downloading
    install_server
fi
progress configuring
python3 /home/steam/server/config.py
SERVER_EXEC="$SERVER_FILES/RSDragonwilds/Binaries/Linux/RSDragonwildsServer-Linux-Shipping"
if [[ ! -f "$SERVER_EXEC" ]]; then
    echo 'Game executable missing. Enable UPDATE_ON_START to install it.' >&2
    exit 1
fi
chmod +x "$SERVER_EXEC"
CRASHPAD="$SERVER_FILES/RSDragonwilds/Plugins/Developer/Sentry/Binaries/Linux/crashpad_handler"
if [[ -f "$CRASHPAD" ]]; then chmod +x "$CRASHPAD"; fi
# The game does not derive its beacon from -Port; configure both explicitly.
args=(RSDragonwilds -log -NewConsole "-Port=${DEFAULT_PORT:-7777}"
      "-ini:Engine:[/Script/OnlineSubsystemUtils.OnlineBeaconHost]:ListenPort=$(( ${DEFAULT_PORT:-7777} + 1111 ))"
      "-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=${MAX_PLAYERS:-6}")
if [[ -n "${MULTIHOME:-}" ]]; then args+=("-MULTIHOME=$MULTIHOME"); fi
echo "Starting game on UDP ${DEFAULT_PORT:-7777}; beacon is game port + 1111"
progress starting
exec "$SERVER_EXEC" "${args[@]}"
