# Dragonwilds server + admin panel

A Docker deployment for the RuneScape: Dragonwilds dedicated server, with a password-protected web panel, Steam update checks, controlled restarts, offline backups, and persistent world data. This project extends [indifferentbroccoli/runescape-dragonwilds-server-docker](https://github.com/indifferentbroccoli/runescape-dragonwilds-server-docker) and retains its GPL-3.0 license.

The supplied containers target **Linux x86_64 / amd64**. The game is installed at runtime from Steam dedicated-server app **4019830**. Native ARM and ARM emulation are unsupported by this deployment.

## Contents

- [Features and boundaries](#features-and-boundaries)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration reference](#configuration-reference)
- [Networking and HTTPS](#networking-and-https)
- [Using the admin panel](#using-the-admin-panel)
- [Updates and restart protection](#updates-and-restart-protection)
- [Data, configuration, and backups](#data-configuration-and-backups)
- [Operations](#operations)
- [Admin HTTP API](#admin-http-api)
- [Troubleshooting](#troubleshooting)
- [Architecture and repository layout](#architecture-and-repository-layout)
- [Development and verification](#development-and-verification)
- [GitHub automation and releases](#github-automation-and-releases)
- [Artwork and licensing](#artwork-and-licensing)

## Features and boundaries

| Capability | Behavior |
| --- | --- |
| Server controls | Start, stop, and restart the project's game container, with confirmation in the panel and a 120-second graceful-stop allowance. |
| Monitoring | Container state, local health, CPU/RAM, startup stages, recent logs, log search, and log export. |
| Steam versions | Installed and public Steam build IDs from SteamCMD manifest/metadata. No guessed game version strings. |
| Automatic patching | Check on panel-service startup and every ten minutes; restart for a newer build subject to a UTC maintenance window and a persisted two-hour cooldown. |
| Manual Steam check | Refresh metadata without directly restarting the game; limited to once per minute. |
| Daily maintenance | Optional daily restart hour, sharing the window and automatic cooldown. |
| Save protection | Offline backups before startup updates; retention and preservation of server identity, moderation records, and unmanaged INI fields. |
| In-game administration | Use the game's Server Management screen for supported ownership/admin/moderation actions. |
| Web chat, broadcast, kick, save-now, live player list | Not implemented: no authoritative external command/query interface was verified. Log-derived player estimates are not used to decide restart safety. |
| Backup browser, web restore/import, notifications | Possible future additions; not implemented. |

There is no verified wrapper setting to force world simulation while the server is empty. Real-game command probes did not establish a working external administration transport; the panel therefore exposes only the verified controls listed above.

## Requirements

- An x86_64 Linux host, Docker Engine, and the Docker Compose plugin. The admin client uses Docker API **v1.45**, so the daemon must accept that API version.
- Permission to use the Docker daemon; Bash if using the optional source-build deployment scripts.
- RAM for the game plus the host and panel. Jagex's guide gives **2 GB + 1 GB per player**, or 8 GB for six players. See the [official server guide](https://dragonwilds.runescape.com/news/how-to-dedicated-servers).
- Plan for at least **20 GB free disk**, plus space for retained backups and growth; this is the project's deployment allowance.
- Outbound connectivity for GHCR image pulls (or source builds), Steam downloads/metadata, and the game's online services. Both game UDP ports must be reachable by players.
- A real **32-character hexadecimal Player ID** from in-game Settings. A Steam ID is not a substitute.
- Separate strong passwords for in-game administration and the web panel.

The images contain their runtime dependencies; production hosts do not need Node or Python installed. Local development uses Node 24, Python 3.11+, and ShellCheck. The CI Compose override requires Compose **2.24.4+** for `!override`.

## Quick start

### Deploy published GHCR images (recommended)

Create a directory on your Linux server and save the complete example below as `docker-compose.ghcr.yml`. This setup pulls the published game and admin images. **No repository clone, local image build, or `.env` file is required.** All settings are edited directly in the Compose file. The same example is available as [docker-compose.ghcr.yml](docker-compose.ghcr.yml).

```bash
mkdir -p dragonwilds
cd dragonwilds
```

```yaml
# Edit settings directly in this file. No .env file is required.
# Keep the Compose project name aligned with admin.COMPOSE_PROJECT_NAME.
# Deploy: docker compose -p dragonwilds -f docker-compose.ghcr.yml up -d
name: dragonwilds
services:
  game:
    image: ghcr.io/arumes31/runescape-dragonwilds-server:latest
    platform: linux/amd64
    container_name: dragonwilds-game
    # Automatic restart policy is managed by the admin service.
    restart: "no"
    stop_grace_period: 120s
    ports:
      - "7777:7777/udp"
      - "8888:8888/udp"
    environment:
      PUID: "1000"
      PGID: "1000"
      # Required: Player ID from in-game Settings (32 hexadecimal characters).
      OWNER_ID: ""
      # Required: in-game administration password.
      ADMIN_PASSWORD: ""
      WORLD_PASSWORD: ""
      SERVER_NAME: "DragonWildsServer"
      DEFAULT_WORLD_NAME: "MyWorld"
      DEFAULT_PORT: "7777"
      # Must equal DEFAULT_PORT + 1111; also update both port mappings above.
      BEACON_PORT: "8888"
      MAX_PLAYERS: "6"
      MULTIHOME: ""
      UPDATE_ON_START: "true"
      GENERATE_SETTINGS: "true"
      BACKUP_KEEP: "7"
    volumes:
      - ./server-files:/home/steam/server-files
      - ./backups:/backups
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
  admin:
    image: ghcr.io/arumes31/runescape-dragonwilds-server-admin:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Required: separate panel password with at least 20 characters.
      ADMIN_GUI_PASSWORD: ""
      GAME_CONTAINER: dragonwilds-game
      COMPOSE_PROJECT_NAME: dragonwilds
      # Set to your exact panel URL, with scheme and no trailing slash.
      ADMIN_ORIGINS: "http://localhost:8080,http://127.0.0.1:8080"
      ADMIN_TRUSTED_PROXIES: ""
      AUTO_UPDATE_WINDOW_UTC: "anytime"
      AUTO_UPDATE_UTC_HOUR: "off"
      AUTO_UPDATE: "true"
    # Replace 0 with the output of: stat -c '%g' /var/run/docker.sock
    group_add: ["0"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - admin-state:/data
      - ./server-files:/game-data:ro
    read_only: true
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    tmpfs: [/tmp]
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
volumes:
  admin-state:
```

Before starting, fill in the required values:

1. `game.environment.OWNER_ID`: your real **32-character hexadecimal Player ID** from in-game Settings.
2. `game.environment.ADMIN_PASSWORD`: your in-game administration password. Set a separate **20+ character** password in `admin.environment.ADMIN_GUI_PASSWORD`. Generate each with `openssl rand -hex 24`.
3. `PUID` and `PGID`: the non-root data owner's numeric UID/GID, reported by `id -u` and `id -g` for that account. Replace `admin.group_add: ["0"]` with the Docker socket group reported by `stat -c '%g' /var/run/docker.sock`.
4. `SERVER_NAME`, `DEFAULT_WORLD_NAME`, and optional `WORLD_PASSWORD`: your server/world settings. For an imported save, match its internal world name in `DEFAULT_WORLD_NAME`.
5. `ADMIN_ORIGINS`: your exact panel URL, for example `https://dragonwilds.example.net`, with no trailing slash. Configure `ADMIN_TRUSTED_PROXIES` with your proxy's actual peer IP/CIDR as described in [Networking and HTTPS](#networking-and-https).
6. Check the host data paths and ports. The panel is published on **0.0.0.0:8080** by default for reverse-proxy access. Both UDP ports must be reachable by players. If changing the game port, update both UDP mappings and their environment values; beacon must equal game port + 1111.

Keep the project name `dragonwilds`, `admin.environment.COMPOSE_PROJECT_NAME`, container name `dragonwilds-game`, and `admin.environment.GAME_CONTAINER` aligned. In Portainer, use **dragonwilds** as the stack name or update the matching project/container settings. For Portainer deployments, use absolute host paths for `server-files` and `backups` in both services so their location is explicit.

Keep your configured Compose file private because it contains passwords. In Compose YAML, escape a literal `$` as `$$`; the hexadecimal password generator above avoids interpolation characters. Then validate and start:

```bash
chmod 600 docker-compose.ghcr.yml
docker compose -p dragonwilds -f docker-compose.ghcr.yml config --quiet
docker compose -p dragonwilds -f docker-compose.ghcr.yml pull
docker compose -p dragonwilds -f docker-compose.ghcr.yml up -d --no-build --wait --wait-timeout 1200
docker compose -p dragonwilds -f docker-compose.ghcr.yml ps
docker compose -p dragonwilds -f docker-compose.ghcr.yml logs -f --tail=100 game
```

First startup installs and validates the game from Steam. A slow download can exceed the 20-minute wait while the containers continue working; follow the game logs before taking further action. Open the URL configured in `ADMIN_ORIGINS`, sign in with `ADMIN_GUI_PASSWORD`, and use the displayed **Join code** when the game publishes it. The configured world password still applies.

Use the same `-p dragonwilds -f docker-compose.ghcr.yml` options for later commands. To update the container images, repeat `pull` and `up`. To apply edited settings, run `up -d`; `restart` does not reload Compose environment values. Steam installs/updates the actual game separately on startup when `UPDATE_ON_START=true`.

Successful main-branch GHCR runs publish `latest`; stable releases also update `latest`, while prereleases do not. Wait for publication before pulling, or select an available release tag. Pin matching game/admin digests for reproducible deployments. Authenticate to GHCR first if the selected packages require it. See [GitHub automation and releases](#github-automation-and-releases) for publication and rollback details.

### Alternative: build from source

Clone the repository on the Linux host (or use an extracted deployment archive):

```bash
git clone https://github.com/arumes31/runescape-dragonwilds-server.git
cd runescape-dragonwilds-server
```

Then configure the deployment:

```bash
cp .env.example .env
chmod 600 .env
id -u
id -g
stat -c '%g' /var/run/docker.sock
openssl rand -hex 24
```

Edit `.env` before starting:

1. Set `OWNER_ID` to your real in-game Player ID.
2. Set `ADMIN_PASSWORD` and a separate `ADMIN_GUI_PASSWORD` of at least 20 characters. Run the password generator again for a separate value.
3. Set `PUID` and `PGID` to the non-root numeric account/group that should own game data; set `DOCKER_GID` to the socket group reported above.
4. Set `SERVER_NAME`, `DEFAULT_WORLD_NAME`, and optionally `WORLD_PASSWORD`.
5. Set `ADMIN_ORIGINS` to the exact URL you will use, including scheme and nonstandard port. For a public deployment, use your HTTPS proxy URL.
6. Confirm data paths, UDP ports, and the panel binding. By default the panel is published on every host interface at port 8080.

```bash
bash scripts/deploy.sh
docker compose ps
docker compose logs --tail=100 game
```

The deployment script checks the host architecture and Compose configuration, builds both images with `--pull --no-cache`, then waits up to 20 minutes for readiness. It does not pull Git commits. First startup downloads and validates the game; a slow download can exceed the wait while the containers continue working. Follow `docker compose logs -f game` before taking further action. Never start a second game process against the same data directory.

Open the URL configured in `ADMIN_ORIGINS` and sign in with `ADMIN_GUI_PASSWORD`. For a local-only panel use `ADMIN_BIND_IP=127.0.0.1` and the default localhost origins. After changing environment values, run `docker compose up -d` to recreate affected containers; `docker compose restart` does not reload `.env`.

To find the world, use the game's **Worlds → Public** tab and search its exact, case-sensitive world name. Existing saves retain their own world identity. See the [official joining instructions](https://dragonwilds.runescape.com/news/how-to-dedicated-servers).

## Configuration reference

Defaults below describe the source-build Compose deployment and [.env.example](.env.example). For the standalone GHCR deployment, edit the matching `environment`, `image`, `ports`, `volumes`, and `group_add` entries directly in [docker-compose.ghcr.yml](docker-compose.ghcr.yml). Empty required values must be filled before deployment. Boolean game settings accept lowercase `true` or `false`.

### Game settings

| Variable | Default | Meaning / accepted values |
| --- | --- | --- |
| `OWNER_ID` | Required | Exactly 32 hexadecimal characters from in-game Settings. |
| `ADMIN_PASSWORD` | Required | Nonblank password for the game's Server Management screen. Separate from panel authentication. |
| `WORLD_PASSWORD` | Empty | Optional world access password. |
| `SERVER_NAME` | `DragonWildsServer` | Server display name. |
| `DEFAULT_WORLD_NAME` | `MyWorld` | Name used when creating a world; changing it does not rename existing saves. |
| `DEFAULT_PORT` | `7777` | Game UDP port; integer 1024–64424. |
| `BEACON_PORT` | `8888` | Must equal `DEFAULT_PORT + 1111`. Set both variables when changing ports. |
| `MAX_PLAYERS` | `6` | Integer 1–6, supplied to the game through its launch arguments. |
| `MULTIHOME` | Empty | Optional game `-MULTIHOME` bind address; must make sense inside the container. Usually leave empty. |
| `PUID` | `1000` | Game-data owner UID; integer 1–2147483647. |
| `PGID` | `1000` | Game-data owner GID; integer 1–2147483647. |
| `UPDATE_ON_START` | `true` | Back up existing saves, then install/validate the current Steam build on every start. Required for first installation. |
| `GENERATE_SETTINGS` | `true` | Merge environment-managed INI fields. `false` preserves an existing INI byte-for-byte; first startup still creates it. |
| `BACKUP_KEEP` | `7` | Retain 1–100 successful automatic backup archives. |

Configuration is validated before downloading. INI-managed values reject control characters and double quotes. World names must be nonblank and filename-safe: no `/ \ : * ? < > |`, `.`, `..`, or whitespace followed by `#`. Keep comments on their own lines. In `.env`, use single quotes around passwords containing literal `$` or `#` to avoid interpolation/comment surprises.

`GENERATE_SETTINGS=false` does not bypass startup environment validation. Ports and player capacity still come from launch arguments, even when INI generation is disabled.

### Deployment and storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `dragonwilds` | Compose namespace; game container becomes `<project>-game`. Also identifies the allowed control target and named state volume. |
| `SERVER_DATA_PATH` | `./server-files` | Host bind mount for game installation, worlds, config, logs, and installed manifest. |
| `BACKUP_PATH` | `./backups` | Host bind mount for offline archives. |
| `GAME_BIND_IP` | `0.0.0.0` | Host interface on which both UDP ports are published. |
| `ADMIN_BIND_IP` | `0.0.0.0` | Host interface on which the panel is published. |
| `ADMIN_PORT` | `8080` | Host panel port; container listens on TCP 8080. Match nonstandard ports in `ADMIN_ORIGINS`. |
| `DOCKER_GID` | `0` | Supplementary group for access to the host Docker socket. Set it from the actual Linux socket's group ID. |
| `GAME_IMAGE` | `dragonwilds-server:local` | Game image name/tag or digest. Compose also has a local build definition. |
| `ADMIN_IMAGE` | `dragonwilds-admin:local` | Admin image name/tag or digest. Compose also has a local build definition. |

Relative data paths are relative to the Compose project directory. Use separate project names, data/backup directories, and published ports for separate deployments. Changing the project name also selects a different admin-state volume, so it changes which persisted restart history and window override are loaded.

### Panel and update policy

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_GUI_PASSWORD` | Required | Panel password, at least 20 characters. |
| `ADMIN_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | Comma-separated exact HTTP(S) origins. No path, trailing slash, query, or fragment. Host checks use this list. All origins must be HTTPS to enable Secure cookies automatically. |
| `ADMIN_TRUSTED_PROXIES` | Empty | Comma-separated proxy peer IPs/CIDRs. Empty ignores forwarding headers; universal `/0` trust is rejected. |
| `AUTO_UPDATE` | `true` | `false` disables newer-build-triggered restarts while keeping metadata checks. It does **not** disable a configured daily restart. |
| `AUTO_UPDATE_UTC_HOUR` | `off` | Optional daily restart hour, 0–23 UTC; independent of `AUTO_UPDATE`, but still requires startup updates and obeys window/cooldown checks. |
| `AUTO_UPDATE_WINDOW_UTC` | `anytime` | `anytime` or `HH:MM-HH:MM` UTC, including overnight intervals. Panel overrides persist and take precedence. |

To disable **all scheduled automatic restarts**, use both `AUTO_UPDATE=false` and `AUTO_UPDATE_UTC_HOUR=off`. Manual starts/restarts still install updates when `UPDATE_ON_START=true`.

### Advanced container settings

These are supported by the underlying scripts/services but are **not forwarded by the supplied Compose file**. They require a deliberate Compose override or custom container invocation; adding them to `.env` alone has no effect.

| Setting | Default / behavior |
| --- | --- |
| `SERVER_FILES` | Game scripts' installation root; defaults to `/home/steam/server-files`. Mounts and admin read paths must remain consistent if customized. |
| `REGENERATE_SERVER_INI_ON_RESTART` | Compatibility alias: `false` preserves an existing INI, even if `GENERATE_SETTINGS=true`. |
| `ADMIN_PASSWORD_FILE` | Admin-service fallback file containing the panel password when `ADMIN_GUI_PASSWORD` is absent. Requires mounting the file and changing Compose's required-password wiring. |
| `GAME_CONTAINER` | Admin target container; Compose sets it to `<project>-game`. Target must carry the matching Compose project and `game` service labels. |
| `STATE_FILE` | Admin policy/history file, default `/data/maintenance.json`. |
| `PORT` | Admin internal HTTP port, default 8080. Customizing requires matching port mapping and health-check changes. |
| `DEPOT_DOWNLOADER_VERSION` | Game-image **build argument**, default `3.4.0`. DepotDownloader remains bundled for upstream compatibility; the active install/update path uses SteamCMD. |

## Networking and HTTPS

| Traffic | Default | Exposure |
| --- | --- | --- |
| Game | UDP 7777 | Reachable by players. |
| Beacon | UDP 8888 | Reachable by players; always game port + 1111. |
| Web panel | TCP 8080 | Management access; restrict public access to the HTTPS proxy. |
| Docker API | Unix socket | Mounted into the admin container; no TCP Docker endpoint is configured. |

Forward **both UDP ports** through the host firewall, cloud firewall, and router as applicable. Keep external and internal numbers identical. The HTTP reverse proxy does not carry game UDP traffic. For custom game port 27777, set beacon 28888 and forward that pair.

### Reverse proxy example

For a proxy on the Docker host, set `ADMIN_BIND_IP=127.0.0.1`, `ADMIN_ORIGINS=https://dragonwilds.example.net`, and terminate TLS in your proxy. An Nginx location inside an existing TLS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

For a proxy on another machine, use the Docker host's reachable private address, adjust `ADMIN_BIND_IP`, and restrict incoming panel-port access to that proxy. For a containerized proxy, use its actual reachable Docker network path; loopback inside that proxy refers to the proxy itself.

Set `ADMIN_TRUSTED_PROXIES` to the proxy's actual peer address as seen by the admin container. Docker NAT can make a host proxy appear as the bridge gateway rather than 127.0.0.1. A fixed container proxy address could use `172.30.0.2/32`; use the narrowest appropriate range.

The example overwrites client-supplied forwarding headers. In a controlled proxy chain, every proxy must append its actual peer. The panel walks `X-Forwarded-For` right to left to the first untrusted address, ignores forwarding from untrusted peers, and rejects malformed forwarding from trusted peers. Equivalent IPv6 spellings and IPv4-mapped IPv6 share a throttle bucket. HTTPS cookie behavior is derived from `ADMIN_ORIGINS`, not arbitrary forwarded headers.

### Management access

The panel has a single shared password and no per-user roles. Sessions last eight hours, use HttpOnly/SameSite=Strict cookies, and are held in memory; restarting/recreating the admin container signs everyone out. Login allows ten attempts per client per fifteen minutes, with at most four concurrent password checks.

The admin process runs as the image's non-root `node` user with a read-only root filesystem, dropped capabilities, and no-new-privileges. **Its Docker socket access still grants host-level Docker authority.** Treat the panel as a trusted management service. The application restricts controls to the configured Compose `game` service and exposes no arbitrary shell/exec endpoint.

## Using the admin panel

- **Status and resources:** the browser polls every five seconds. CPU uses Docker's multicore percentage convention and may exceed 100%; memory excludes inactive file cache. Stopped containers report zero usage. Resource limits are not imposed by this Compose file.
- **Start / Stop / Restart:** confirm the requested action. Stop/restart disconnect players. Only one control action runs at a time. Docker accepting an action does not mean the game is ready.
- **Logs:** the latest 200 timestamped stdout/stderr lines, refreshed by polling. Search filters that snapshot locally. Export downloads the entire latest snapshot, including lines hidden by the search filter; it is not a full historical log download.
- **Redaction:** the panel replaces nonempty container environment values whose names contain `PASSWORD`, `SECRET`, `TOKEN`, or `OWNER_ID`. This does not guarantee that arbitrary game-generated identifiers are removed. Direct Docker/file logs do not use this redaction.
- **Check Steam now:** starts a metadata refresh with no direct restart. Concurrent requests return a conflict; manual checks are limited to one per minute. Background auto-patching remains independent.
- **Maintenance window:** save `anytime` or a UTC interval. **Use environment** removes the persistent panel override. Saving a window does not restart the game.

Startup progress distinguishes backup, download/verification, configuration, starting, locally healthy running, stopped, and failure. Records are written atomically to `server-files/.dragonwilds-startup.json` and compared with the container's start time so stale records do not describe a new run. Detailed Steam output remains in logs; no invented download percentage is displayed.

## Updates and restart protection

### Startup sequence

1. Validate environment and architecture.
2. Prepare the configured UID/GID and repair ownership of installation and backup files.
3. If `UPDATE_ON_START=true`, back up the existing `RSDragonwilds/Saved` tree, then run anonymous SteamCMD `app_update 4019830 validate`.
4. Retry installation up to three times, ten seconds apart. A failed update stops startup.
5. Create or merge configuration, then launch the Linux shipping executable with explicit game port, beacon port, and maximum players.

The game runs as the `steam` account after initial ownership setup. Tini forwards signals; stop/restart allows 120 seconds before Docker may force termination.

### Build detection and automatic restarts

The installed build comes from `steamapps/appmanifest_4019830.acf` only when its app ID matches and `StateFlags=4` confirms full installation. New, incomplete, and legacy DepotDownloader-only installations display **Unknown / not installed** until SteamCMD validation creates a valid manifest.

The admin service queries Valve independently on startup and every ten minutes. A strictly newer public build can trigger a restart when:

- `AUTO_UPDATE=true` and `UPDATE_ON_START=true`.
- The game is running, no control action is busy, and no active backup/download/configuration or health-starting state blocks it.
- The effective UTC window is open.
- At least two hours have elapsed since the previous automatic restart attempt.

Steam metadata errors are displayed and suppress that check's newer-build restart. They do not disable the independently configured daily schedule. Stopped or crashed game containers are not automatically started.

The cooldown timestamp is persisted **before** issuing the restart. Failed attempts count; inability to persist the timestamp prevents the automatic restart. Manual Start/Restart bypass the window and cooldown and neither consume nor reset automatic restart history. Keep the `admin-state` volume and run only one admin replica.

### Windows and daily maintenance

`AUTO_UPDATE_WINDOW_UTC=04:00-06:00` allows automatic restarts from 04:00 inclusive to 06:00 exclusive. `23:30-01:15` crosses midnight. Equal endpoints are invalid; use `anytime` for all day. UTC does not shift with daylight saving time.

A panel-saved window overrides the environment until **Use environment** clears it. Opening a window does not immediately trigger a Steam check; pending patches are reconsidered on the next five-minute check. Closing a window does not interrupt work already started.

`AUTO_UPDATE_UTC_HOUR` is checked every 30 seconds during the configured hour. It shares the window and two-hour guard and is considered at most once per UTC day after its initial eligibility checks. A stopped server or cooldown can cause that day's attempt to be skipped; it is not a guaranteed restart or a queued catch-up job. Choose an hour that overlaps the window.

Automatic restart safety is based on process/startup state, not player presence: the project has no verified live player roster or broadcast countdown.

### Game, image, and host updates

- **Game:** installed by SteamCMD at startup when enabled.
- **Container/base OS:** rebuild reviewed local source with `bash scripts/deploy.sh`, or pull selected published images and recreate containers.
- **Host kernel/Docker:** maintained separately on the Linux host.

The game deliberately has `restart: "no"` so Docker cannot bypass the automatic restart guard. Following a host reboot or game crash, explicitly start it with `docker compose up -d` or the panel after investigating failures. The admin service uses `unless-stopped`.

## Data, configuration, and backups

### Persistent paths

Paths below assume default host directories:

| Host path / volume | Container path | Contents |
| --- | --- | --- |
| `server-files/` | Game: `/home/steam/server-files`; admin: `/game-data` (read-only) | Installed game, manifest, saves, INI, game logs, startup record. |
| `backups/` | Game: `/backups` | `saved-<UTC timestamp>.tar.gz` archives. |
| `<project>_admin-state` named volume | Admin: `/data` | `maintenance.json` policy/restart history and the admin's SteamCMD working files/cache. |

The wrapper manages `server-files/RSDragonwilds/Saved/Config/LinuxServer/DedicatedServer.ini`. Under `[/Script/Dominion.DedicatedServerSettings]` it updates only `AdminPassword`, `OwnerId`, `WorldPassword`, `ServerName`, and `DefaultWorldName`. It preserves the server GUID, repeated KnownPlayerList entries (including moderation data), unknown keys, and other sections.

To manage the INI manually, stop the game, set `GENERATE_SETTINGS=false`, edit the existing file, and recreate the game service to apply the environment change. Live INI edits can be overwritten by the game. Generated INI files and completed backup archives use mode 0600.

### Backup behavior

Every startup with `UPDATE_ON_START=true` attempts an offline backup before Steam validation, even if no newer build exists. First installation has nothing to back up. With startup updates disabled, no automatic startup backup is created.

Archives contain the entire `Saved/` tree, including worlds, configuration, and logs, **not** the installation or the admin-state volume. A temporary `.partial` file becomes a completed archive only after success; retention removes older `saved-*.tar.gz` files after the new archive succeeds. Backup failures stop startup.

Backups contain game settings/passwords. Protect them and keep a separate off-host copy. This is not a periodic backup service; a crash can preserve only the game's last completed save. Back up `.env` and the admin-state volume separately when planning a full host recovery.

### Restore a backup

1. Stop the game: `docker compose stop game`. Ensure no other process is using its data.
2. Copy the current `RSDragonwilds/Saved` directory to a separate recovery location.
3. Inspect a trusted archive before extracting; it should contain a top-level `Saved/` directory.
4. Move the current `Saved` directory aside, then extract the archive into `server-files/RSDragonwilds/`. This avoids mixing restored and newer world files.
5. Check `.env`: startup can reapply managed INI fields and update the game. For exact INI preservation set `GENERATE_SETTINGS=false`; to avoid a Steam update set `UPDATE_ON_START=false` only when the installed game is usable.
6. Run `docker compose up -d game` to apply settings and start. Inspect logs/health, then verify the world with an actual game client.

Adjust paths for `SERVER_DATA_PATH` and `BACKUP_PATH`. Never extract an untrusted archive or overwrite a live world. A backup of saves alone is not a rollback of the installed Steam build.

### Import an existing world

Stop the server and back up its current saves, then place the chosen world `.sav` in the server's actual save directory, moving competing saves aside first. Match filesystem casing on Linux. Restart and confirm the loaded world in the logs/client. Creating a new `DEFAULT_WORLD_NAME` does not replace existing worlds. Follow the [vendor's world-management guide](https://dragonwilds.runescape.com/news/how-to-dedicated-servers) for game-specific import steps; no web import/restore workflow is implemented.

## Operations

Run from the project directory using the intended environment file:

| Command | Purpose |
| --- | --- |
| `docker compose config --quiet` | Validate Compose interpolation without printing secrets. |
| `docker compose ps` | Inspect container and health state. |
| `docker compose logs -f --tail=200 game` | Follow raw game/Steam output; may contain sensitive values. |
| `docker compose logs --tail=100 admin` | Investigate login, proxy, Docker, or update-controller errors. |
| `docker compose stop game` | Gracefully stop the game while keeping the panel available. |
| `docker compose start game` | Start an existing game container with its existing environment. |
| `docker compose restart game` | Manual restart; can install patches and bypasses panel automatic limits. |
| `docker compose up -d` | Create/recreate affected services, apply `.env` changes, and start stopped services. |
| `docker compose down` | Remove containers/network while retaining bind-mounted data and the named state volume. |
| `bash scripts/deploy.sh` | Rebuild both images from reviewed source with refreshed base images/packages and wait for readiness. |

For the primary GHCR quick start, add `-p dragonwilds -f docker-compose.ghcr.yml` to the `docker compose` commands above. For source deployments using a nondefault environment file, use `--env-file <file>` consistently. Avoid `down --volumes` for production: it deletes persisted admin policy/restart history. Do not reuse production save paths for tests.

## Admin HTTP API

The panel is a same-origin HTTP application, not a general CORS service. Requests must use an allowed `Host`; the public `GET /healthz` route is the exception. Every API route except login requires the `dw_session` cookie.

For non-GET requests, supply `X-Requested-With: DragonwildsAdmin`. If `Origin` is present, it must exactly match an allowed origin. Send JSON with `Content-Type: application/json` for requests with bodies. Login requires that content type; parsed request bodies are capped at 4096 characters.

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/healthz` | Public `{"ok":true}`; only proves the HTTP service responds. |
| POST | `/api/login` | `{"password":"..."}`; sets an eight-hour session cookie on success. |
| POST | `/api/logout` | Removes the current session and expires its cookie. |
| GET | `/api/status` | State/health/start time, exit/OOM details, latest action, versions, startup progress, maintenance source/window, cooldown, and check eligibility. |
| GET | `/api/resources` | `cpuPercent`, `memoryBytes`, `memoryLimitBytes`. |
| GET | `/api/logs` | `{"logs":"..."}`, latest 200 lines with panel redaction. |
| POST | `/api/start` | Start request; returns 202 when queued. |
| POST | `/api/stop` | Stop request; returns 202 when queued. |
| POST | `/api/restart` | Restart request; returns 202 when queued. |
| POST | `/api/check-steam` | Non-restarting metadata check; returns 202 when started. |
| POST | `/api/maintenance` | `{"window":"04:00-06:00"}`, `{"window":"anytime"}`, or `{"window":null}` to reset; returns effective window status. |

Poll status after a 202 response to observe completion/failure. Expected errors include 400 for malformed JSON/window input, 401 for authentication, 403 for host/origin rejection, 409 for an in-progress operation, 415 for non-JSON login, and 429 for throttling. Manual Steam-check throttling includes `Retry-After`. Docker/upstream request failures can return 502; inspect admin logs.

## Troubleshooting

| Symptom | Checks / resolution |
| --- | --- |
| Compose says a required variable is missing | Copy and edit `.env.example`; confirm the intended `--env-file`, real owner ID, and both admin passwords. |
| Configuration error before download | Check ID format, lowercase booleans, world-name restrictions, numeric ranges, and beacon = game port + 1111. |
| Panel returns `Unrecognized host` or origin rejection | Match the exact browser scheme/host/port in `ADMIN_ORIGINS`, preserve Host through the proxy, and recreate the admin service. |
| Login succeeds but the session does not work | HTTPS-only origins enable Secure cookies; use HTTPS. Admin restarts expire all sessions. |
| All users share a login lockout behind a proxy | Configure the actual narrow proxy peer/CIDR and correct forwarding headers. Wait for the fifteen-minute attempt window to expire. |
| Panel shows Docker errors or unavailable status | Check `DOCKER_GID`, socket permissions/API compatibility, container name, and matching Compose project/service labels. Read admin logs. |
| Installed build is unknown | Confirm a fully installed Steam manifest; start with `UPDATE_ON_START=true` to validate. Do not fabricate/edit build IDs. |
| Steam metadata unavailable | Check outbound network/DNS and admin logs. Newer-build restarts pause until a successful check; a configured daily schedule remains separate. |
| Patch is available but no restart occurs | Check both update switches, window override, two-hour cooldown, running/health/startup state, and last action. Automatic scheduling never starts a stopped game. |
| Automatic restart occurs despite `AUTO_UPDATE=false` | Also set `AUTO_UPDATE_UTC_HOUR=off` to disable the independent daily restart. |
| Deployment times out during first installation | Follow game logs; the 20-minute CLI wait is not a download cancellation. Do not start another process on the same files. |
| Game stays stopped after a crash/reboot | Expected under `restart: "no"`. Fix the cause, then start manually. Check OOM status and available memory/disk. |
| Healthy server is not joinable | Verify a real owner ID, client/server versions, world search name, and reachability of both UDP ports across every firewall/router. Local health is not a join test. |
| Custom port works incompletely | Set both ports with the required 1111 offset and identical external/internal mappings. |
| Settings or world name appear unchanged | Recreate containers after `.env` edits; check `GENERATE_SETTINGS` and existing saves. Existing world names are not renamed by the default-world setting. |
| Permission denied or slow ownership setup | Check numeric UID/GID and writable data/backup mounts. Startup traverses existing files to repair ownership. |
| Logs are incomplete in the panel | Panel logs cover the latest 200 lines only. Inspect raw Docker logs or saved game logs for older output; review before sharing. |

The game health check requires the shipping process plus both expected bound UDP ports. It runs every 30 seconds with a 15-minute startup grace, a five-second timeout, and three retries. It does not validate external routing, authentication, or multiplayer. The admin health endpoint does not test the Docker socket or Steam.

## Architecture and repository layout

Two services share the game-data directory: the game can write it; the panel mounts it read-only. The panel uses the Docker socket for lifecycle/log/resource access and its own SteamCMD copy for public build metadata. The game installs and launches its own payload.

```text
.
├── Dockerfile                 Game image, tools, entrypoint, health check
├── docker-compose.yml         Production services, ports, mounts, security
├── docker-compose.ghcr.yml    Standalone deployment from published images
├── docker-compose.ci.yml      Named-volume fixture override
├── .env.example               Deployment configuration template
├── scripts/
│   ├── init.sh / start.sh     Validation, ownership, backup/update, launch
│   ├── functions.sh           Retried SteamCMD install/validation
│   ├── config.py              Environment validation and INI merge
│   ├── backup.py              Offline archive creation and retention
│   ├── progress.py            Atomic startup progress records
│   ├── healthcheck.py         Local process/UDP health
│   ├── deploy.sh              Source build and deployment
│   ├── ci-checks.sh           Syntax checks and unit tests
│   ├── ci-scan-images.sh      Container vulnerability gate
│   └── package.sh             HEAD source ZIP and SHA256SUMS
├── admin/
│   ├── Dockerfile            Node 24 runtime with SteamCMD
│   ├── server.mjs             HTTP auth/API and Docker/update controller
│   ├── steam.mjs              Steam metadata and installed-build parsing
│   ├── maintenance.mjs        UTC windows and startup-state interpretation
│   ├── proxy.mjs              Trusted-proxy/client-address handling
│   └── public/                Dependency-free browser UI and artwork
├── tests/                    Unit tests and isolated Docker fixture
└── .github/                  Verify, security, release, GHCR, Dependabot
```

There is no npm application dependency install or frontend build step. Both services use Docker JSON-file log rotation at 10 MB × three files; this does not rotate separate game-written files in `Saved`.

## Development and verification

### Static checks and unit tests

On Linux with Node 24 and Python 3.11+:

```bash
bash scripts/ci-checks.sh
shellcheck -x -P SCRIPTDIR scripts/*.sh
docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.12
```

Individual suites require no third-party npm or Python packages:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
```

### Docker integration fixture

Run against the isolated fixture, never production save paths:

```bash
python3 tests/prepare_fixture.py
docker compose --env-file .env.test.local build --pull
docker compose --env-file .env.test.local up -d --wait --wait-timeout 150
python3 tests/integration.py
bash scripts/ci-scan-images.sh
docker compose --env-file .env.test.local down
```

The fixture uses project `dragonwilds-test`, panel `http://localhost:18089`, game/beacon host-loopback ports 17777/18888, and data under `test-results/`. Its generated panel password is in ignored `.env.test.local`. The preparation script preserves an existing environment file; review stale settings before reuse. The fixture binds UDP and handles shutdown but **is not the game**, as its logs state.

Integration exercises authentication, redacted logs, real Docker start/stop/restart, graceful shutdown, identity/moderation persistence, resource data, and logout. CI uses the [named-volume override](docker-compose.ci.yml) and explicitly seeds the fixture; see the [Verify workflow](.github/workflows/verify.yml) for those steps and the [scanner script](scripts/ci-scan-images.sh) for the vulnerability gate.

### Verification evidence and limits

Recorded local verification on September 22–23, 2026: the final Verify run passed **49 unit tests (41 Node, 8 Python)**, linting, both image builds, eight Docker integration checkpoints, and both Trivy gates. Those runs also covered real-game Steam validation of build **25387240**, local process/UDP health, graceful restart, save backup, and browser checks.

These are dated results, not a claim that every check ran for every documentation edit or that this build is still the latest. Earlier CodeQL results predate the final maintenance changes. Real player joins, ownership/moderation, external NAT, production TLS, and hosted GitHub publication remain outside that recorded verification.

For contributions, keep documentation aligned with the scripts and defaults, add focused regression coverage for behavior changes, and run relevant checks above. Never commit `.env`, local test environments, secrets, saves, backups, or raw sensitive logs; the repository ignores these paths.

## GitHub automation and releases

| Workflow | Purpose |
| --- | --- |
| Verify | Push/PR/manual/reusable checks: Actionlint, ShellCheck, syntax/unit tests, both image builds, isolated lifecycle integration, vulnerability scans. |
| GHCR images | After Verify, build game/admin images with SBOM and provenance for main/tag/manual runs. Manual runs default to a non-publishing dry run. |
| CodeQL | JavaScript, Python, and GitHub Actions analysis on PR/main, weekly, or manually. |
| Scheduled container audit | Weekly/manual rebuild and vulnerability checks against refreshed advisory data. |
| Release deployment archive | After Verify, package tracked source and checksums; attach to a published release. |
| Dependabot | Weekly proposals for GitHub Actions and Docker base images; no automatic merging. |

The vulnerability gate rejects fixable HIGH/CRITICAL findings and scanner errors; it does not claim zero vulnerabilities or scan a proprietary game payload downloaded later. No workflow deploys or restarts your game server.

Published packages use `ghcr.io/arumes31/runescape-dragonwilds-server` and `ghcr.io/arumes31/runescape-dragonwilds-server-admin`. Main produces `latest` and full-commit SHA tags; stable version tags also produce version aliases and `latest`. Prereleases do not move `latest`. Repository/package access, branch rules, and hosted security permissions must be configured separately. The [.github/workflows](.github/workflows) definitions contain the exact workflow behavior.

To create a local deployment archive:

```bash
bash scripts/package.sh
```

This writes `dist/dragonwilds-deployment.zip` and `dist/SHA256SUMS` from **committed HEAD**, excluding uncommitted work. Release archives contain source, not saves, secrets, prebuilt images, or the Steam payload. When rolling back container images, preserve backups and remember that startup Steam validation can still install the newest game; save-format compatibility is a separate concern.

## Artwork and licensing

The original [GPL-3.0 license](LICENSE) and upstream attribution are retained. The landscape is newly generated fan-inspired artwork; the rune icon is an original SVG. Neither is an official Jagex asset or endorsement. RuneScape and Dragonwilds remain their respective owners' trademarks.

Game-specific references: [Jagex dedicated-server guide](https://dragonwilds.runescape.com/news/how-to-dedicated-servers), [official dedicated-server repository](https://github.com/runescape/rsdw-dedicated), and [Valve SteamCMD documentation](https://developer.valvesoftware.com/wiki/SteamCMD).

### Join code and server controls

The signed-in admin overview displays the current server **Join code**, with a copy button. The admin service checks `RSDragonwilds/Saved/Logs/RSDragonwilds.log` through its existing read-only `/game-data` mount every five seconds, even while the page is closed. It accepts `LogNetSessionSettings` JoinCode entries from the current container startup only, and recovers the code from that log when the admin container restarts. Missing or unreadable logs show a waiting/error message; stopped servers and pending actions do not expose a previous code. A code being published does not replace an in-game connectivity check or the configured world password.

Stopped containers show **Start**. Running containers show **Restart** and **Stop**. Controls are disabled during a pending action and hidden when Docker state is unavailable or transitioning.

To install these admin-only changes from a source checkout, run `docker compose up -d --build --no-deps admin` with your usual Compose environment file. For GHCR deployments, build/publish the updated admin image and recreate the admin service with that image. The game container does not need a restart for this panel update.
