#!/bin/bash
# SteamCMD owns appmanifest_4019830.acf, providing an authoritative installed build ID.
install_server() {
    local attempt log
    mkdir -p /home/steam/.steamcmd
    if [[ ! -f /home/steam/.steamcmd/steamcmd.sh ]]; then
        cp -a /opt/steamcmd/. /home/steam/.steamcmd/
    fi
    log=$(mktemp)
    for attempt in 1 2 3; do
        echo "Installing/verifying game files (attempt $attempt/3)"
        if /home/steam/.steamcmd/steamcmd.sh +force_install_dir "$SERVER_FILES" \
            +login anonymous +app_update 4019830 validate +quit 2>&1 | tee "$log"; then
            if grep -Fq "Success! App '4019830' fully installed." "$log"; then
                rm -f "$log"
                return 0
            fi
        fi
        if [[ "$attempt" -lt 3 ]]; then sleep 10; fi
    done
    rm -f "$log"
    echo 'Game update failed after three attempts; server will not start.' >&2
    return 1
}
