# Dragonwilds server + admin panel

Local extension of [indifferentbroccoli/runescape-dragonwilds-server-docker](https://github.com/indifferentbroccoli/runescape-dragonwilds-server-docker), retaining its GPL-3.0 license. Built for **Linux x86_64**, Docker Engine and Docker Compose. Native ARM is not supported by the supplied game binary.

## Included

- Password-protected web panel with original Dragonwilds-inspired artwork, live logs, log search/export, CPU/RAM, health and start/stop/restart controls.
- `ADMIN_GUI_PASSWORD` and public URL (`ADMIN_ORIGINS`) configured through Docker environment variables.
- Installed and latest **Steam build IDs**, using the installed appmanifest and Valve SteamCMD metadata, not guessed game version strings.
- Checks every five minutes; a newer public build triggers an update restart. **At most one automatic restart attempt every two hours**, persisted in the admin-state volume. Failed attempts count. **Manual UI restarts bypass the limit and do not reset it.**
- Pre-update offline backups and retention, configuration validation, game identity/ban-list preservation, and graceful signal forwarding.

## Linux deployment

Use an x86_64 host with at least 8 GB RAM for six players and 20 GB free disk, plus room for backups. First install requires Steam network access.

```bash
cp .env.example .env
# Edit .env: OWNER_ID, ADMIN_PASSWORD, ADMIN_GUI_PASSWORD and ADMIN_ORIGINS.
# Generate passwords, for example with: openssl rand -hex 24
# OWNER_ID is your 32-character hexadecimal Player ID from in-game Settings, not Steam ID.
# Set DOCKER_GID to: stat -c '%g' /var/run/docker.sock
chmod 600 .env
bash scripts/deploy.sh
```

The first startup installs/validates the server; large downloads can take longer than the deployment command's 20-minute readiness wait. If so, inspect `docker compose logs -f game` and `docker compose ps`. Do not launch another copy against the same data directory.

Required settings:

| Variable | Purpose |
| --- | --- |
| `OWNER_ID` | Real in-game Player ID. Without one, ownership and player joins cannot be verified. |
| `ADMIN_PASSWORD` | In-game Server Management password. |
| `ADMIN_GUI_PASSWORD` | Separate panel login password, at least 20 characters. |
| `ADMIN_ORIGINS` | Exact public URL, e.g. `https://dragonwilds.example.net`. Comma-separated URLs permitted; no path or trailing slash. |
| `DOCKER_GID` | Host Docker socket group ID so the non-root admin process can use it. |
| `DEFAULT_PORT` / `BEACON_PORT` | Defaults 7777 / 8888. Beacon must be game port + 1111. |

The panel binds to **0.0.0.0:8080 by default**, as requested. `ADMIN_BIND_IP` and `ADMIN_PORT` can override this. Configure `.env`, then recreate containers to apply environment changes: `docker compose up -d`. A simple restart does not reload `.env`.

### Reverse proxy

Terminate HTTPS at your proxy and preserve the original `Host` header. Set `ADMIN_ORIGINS` to that exact HTTPS URL; HTTPS-only origins automatically enable Secure session cookies. Example Nginx location inside your existing TLS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Set `ADMIN_TRUSTED_PROXIES` to the actual proxy peer IPs/CIDRs as seen by the admin container (comma-separated, for example `172.30.0.2/32` for a proxy with that fixed Docker IP). Docker NAT may make a host proxy appear as a bridge gateway; do not assume it appears as 127.0.0.1. Use the smallest appropriate range and restrict the panel port to your proxy. Empty means no forwarding headers are trusted. Universal `/0` trust is rejected.

The example overwrites client-supplied forwarding headers. In a controlled chain of proxies, each proxy must append its actual peer; the panel walks `X-Forwarded-For` from right to left and stops at the first untrusted address. It ignores forwarding from untrusted peers and rejects malformed forwarding from trusted peers. IPv4-mapped IPv6 and equivalent IPv6 spellings share a throttle bucket. Each client gets ten login attempts per fifteen minutes, with bounded asynchronous password verification.

If the proxy is on another machine, use the Docker host's private IP instead. Restrict incoming panel-port access to the proxy. The game uses UDP and does not go through this HTTP proxy. Forward **both game and beacon UDP ports**, keeping each external and internal port number identical. On the same LAN, direct-connect to the server's LAN address if the router does not support NAT loopback.

The admin service has Docker socket access. Even though its HTTP API restricts controls to this project's `game` service and checks its Compose labels, the socket grants host-level Docker authority to the admin container. Treat it as a trusted management service. No arbitrary shell/exec endpoint is exposed.

## Steam patching and restart protection

SteamCMD installs app 4019830 and writes `server-files/steamapps/appmanifest_4019830.acf`. The panel only recognizes an installed build when the manifest reports a fully installed state. New installs, incomplete downloads and legacy DepotDownloader-only installations show **Unknown / not installed** until a successful SteamCMD validation.

The admin service independently queries Valve SteamCMD for the current public build every five minutes. Steam failures are visible and never trigger a restart. A deliberately stopped or crashed game container stays stopped. `UPDATE_ON_START=false` also prevents automatic patching. Set `AUTO_UPDATE=false` to show versions without automatic updates.

The game service intentionally has `restart: "no"`: Docker's own crash-loop policy must not bypass the two-hour guard. If an update or game startup fails, inspect logs and use the UI's manual Start/Restart after fixing the cause. Start the deployment after a host reboot using `docker compose up -d`. The admin service itself uses `unless-stopped`.

The optional `AUTO_UPDATE_UTC_HOUR=0..23` adds a daily maintenance restart; default `off`. It shares the same automatic cooldown and also skips stopped servers. Cooldown state is recorded **before** issuing a restart. Keep the `admin-state` volume: deleting it resets restart history. Do not run multiple admin replicas. Manual restarts do not affect this timestamp.

### Maintenance windows and manual checks

`AUTO_UPDATE_WINDOW_UTC=anytime` preserves automatic patching at any hour. Set a daily UTC interval such as `04:00-06:00` or `23:30-01:15` to restrict **all automatic restarts**, including the optional daily restart. Start time is inclusive and end time exclusive; equal endpoints are invalid. UTC does not change with daylight saving time. Choose `AUTO_UPDATE_UTC_HOUR` inside the window if using the optional daily restart.

The panel lets you edit/save this window. A saved panel value persists in `admin-state` and overrides the environment default; **Use environment** removes that override. Window changes do not restart the game. Pending patches are reconsidered on the next five-minute Steam check. Closing a window does not interrupt an update already in progress. Deliberately stopped servers remain stopped. The two-hour automatic cooldown still applies; manual Start/Restart bypass both the window and cooldown without changing automatic restart history.

**Check Steam now** performs an authenticated, non-restarting metadata refresh. Only one Steam query runs at once, and manual requests are limited to one per minute. Normal background auto-patching remains enabled independently when `AUTO_UPDATE=true`.

The progress panel shows backup, Steam download/verification, configuration, startup, locally healthy running state, or failure. Startup stages are atomically persisted in `server-files/.dragonwilds-startup.json`, survive panel restarts, and are matched to the current container start to exclude stale records. Stage reporting does not invent a download percentage; Steam's detailed output remains in the log. Local process/UDP health does not prove a player can join. Automatic patching skips an active startup/update.

Container/base-OS patches are separate from game patches: run `bash scripts/deploy.sh` to rebuild reviewed local source with fresh base images and package indexes. It never automatically pulls unreviewed GitHub commits. Host kernel/Docker updates are managed by your Linux host.

## Configuration and world data

- `server-files/` persists installation, INI, worlds and Steam manifest.
- `backups/` contains compressed copies of the full `RSDragonwilds/Saved` tree, taken before startup updates while the game is stopped. Default retention: last seven successful archives (`BACKUP_KEEP`). Backups include game settings/passwords: protect this folder.
- `GENERATE_SETTINGS=true` updates only container-managed INI keys and preserves the server GUID, repeated KnownPlayerList entries (including bans/admins), unknown keys and sections.
- `GENERATE_SETTINGS=false` keeps an existing INI byte-for-byte. First startup still creates a config. Direct `docker run` also accepts PR #7's `REGENERATE_SERVER_INI_ON_RESTART=false` alias.
- Keep `.env` comments on their own lines. Use single quotes for passwords containing literal `$` or `#` so Compose does not interpolate them. Multiline/quoted INI values and filename-unsafe world names are rejected before downloading.
- `DEFAULT_WORLD_NAME` names a newly created world and is used in the Worlds browser. Changing it does not rename or replace existing saves. `SERVER_NAME` is the server's separate display name.

To restore: stop the game (`docker compose stop game`), preserve the current Saved directory separately, inspect your chosen trusted archive, extract its `Saved/` directory into `server-files/RSDragonwilds/`, then `docker compose start game`. Never extract untrusted archives or overwrite a live world. Keep an off-host copy of backups. A crash/forced kill can only preserve the game's last completed save.

## Game commands and possible additions

| Feature | Status |
| --- | --- |
| Start, stop, restart, logs, resource monitoring | Implemented via Docker. |
| Steam versions, manual check, patch detection, startup progress, UTC maintenance windows, automatic restart protection | Implemented and regression-tested. |
| Backup before update / preservation of moderation state | Implemented. |
| Ban/unban and admin privileges | Supported through the game's own Server Management screen; not exposed as an unverified web command. |
| Web chat / broadcast announcements / arbitrary admin commands | No supported remote chat/RCON/API verified in the reviewed official sources. Needs a documented game transport before adding working controls. |
| Live online-player list / kick / save-now | No authoritative remote API verified. Log-derived counts would be estimates and are not used to decide restart safety. |
| Always simulate while empty | Upstream issue #9 appears to be game behavior. No supported no-pause option verified. |
| Backup browser, stopped-server world import/restore, notifications | Feasible additions with their own validation and tests. Not represented as implemented. |

See [GAME-CAPABILITIES.md](GAME-CAPABILITIES.md) for the actual running-build command probes and their limits.

Official references: [Jagex dedicated-server guide](https://dragonwilds.runescape.com/news/how-to-dedicated-servers), [official container documentation](https://github.com/runescape/rsdw-dedicated), [Valve SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD). The guide documents in-game moderation and warns that live INI edits are overwritten; this implementation therefore does not edit a running game's settings.

## GitHub automation

See [CI.md](CI.md) for quality gates, CodeQL, scheduled vulnerability audits, Dependabot, release archives and GHCR publication of both images. GHCR builds include SBOM/provenance; manual runs default to a non-publishing dry run.

## Tests

No npm or Python third-party packages are required for the tests.

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
shellcheck -x -P SCRIPTDIR scripts/*.sh
python3 tests/prepare_fixture.py
docker compose --env-file .env.test.local build --pull
docker compose --env-file .env.test.local up -d --wait --wait-timeout 150
python3 tests/integration.py
```

The fixture binds UDP and handles shutdown but **is not the game**. It is clearly labeled in its logs. Integration tests use only the `dragonwilds-test` project and test start/stop/restart against real Docker, persistence, authentication, resource data, and graceful shutdown. The test panel runs at `http://localhost:18089`; its generated password is in `.env.test.local`. Keep test and production environment files separate.

See [UPSTREAM-REVIEW.md](UPSTREAM-REVIEW.md) for every upstream issue/PR disposition and [TEST-RESULTS.md](TEST-RESULTS.md) for the actual local verification and limitations. CI builds both images and runs the same isolated integration suite.

## Artwork and licensing

The repository's original GPL-3.0 license and upstream attribution are retained. The landscape is newly generated fan-inspired artwork; the rune icon is an original SVG. Neither is an official Jagex asset or endorsement. RuneScape and Dragonwilds remain their respective owners' trademarks.
