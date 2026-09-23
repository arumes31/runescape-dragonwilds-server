# Tested game administration interfaces

Tested 2026-09-23 local time with actual Steam dedicated-server app **4019830**, installed/public build **25387240**, Linux amd64. This is evidence for this build, not a promise about future releases.

| Control | Evidence and implementation decision |
| --- | --- |
| Start / stop / restart | Supported through Docker and tested with the real game, including graceful shutdown. Implemented. |
| Installed/latest version and update stages | SteamCMD manifest/metadata and wrapper progress records. Implemented and tested. |
| Live online-player list | No authoritative query interface found. An empty test server cannot validate player join/leave tracking. No fabricated player count is shown. |
| Chat / announcements | No documented or responding remote transport established. Not implemented. |
| Kick | No responding external command interface established. Binary UI names are not proof of a callable remote command. Not implemented. |
| Ban / unban | Jagex documents in-game Server Management: owners can ban/unban online or offline users; admins can ban online regular users. This does not establish an HTTP, RCON, or stdin API. No web moderation endpoint added. |
| Stored known players / bans | The INI's KnownPlayerList records are preserved by the container. They are historical configuration, not a live online-player list. A writable offline editor would need real record fixtures and an end-to-end moderation test before shipping. |

## Runtime probes

1. Started the normal real-game deployment with isolated data and host-loopback UDP 27777/28888. It created its online session and reported `ReadyToJoin=1`; the Docker process/UDP health check passed.
2. Inspected listening sockets inside the game container. No game-owned TCP listener was present. Docker's internal DNS listener is not an admin service. The game/beacon sockets and an additional ephemeral UDP socket were present; no administration protocol was inferred from these sockets.
3. Ran isolated command probes against the real shipping executable, first without network, then with outbound networking and no published ports. Only one process used the test world at a time.
4. Passed `-ExecCmds=Help,ListPlayers,DumpConsoleCommands` at startup. On the online run, waited for successful session initialization, then sent `Help`, `ListPlayers`, `DumpConsoleCommands`, and the read-only `t.MaxFPS` query to the **actual process stdin** using Docker attach. No command listing, player roster, or console response was observed. The launch arguments appearing in logs only prove they were supplied, not executed.
5. Targeted binary-name inspection found in-game player/moderation UI names. Apparent `RCON` substring matches included unrelated strings such as `SDL_GAMECONTROLLERCONFIG`; they do not demonstrate RCON support.
6. Stopped probes gracefully, then deployed the rebuilt normal stack. Real Steam validation succeeded; the new panel observed download/verification, startup and locally healthy running stages.

Raw local probe output is kept under ignored `test-results/command-probe.log`; it is not shipped because game logs may contain server identifiers or settings. Test data remains in `D:/DragonwildsTest/server-files` on this host.

## What remains unverified

No actual player account/Player ID was supplied. Player joins, ownership privileges, chat delivery, kicking a connected client and ban enforcement cannot be truthfully reported as tested. No unsupported plugin, binary patch, guessed RCON service or live INI mutation was installed. A lack of response from these probes is not proof that no internal game RPC exists; it means there is no verified external interface on which to build working panel controls.

Sources: [Jagex dedicated-server guide](https://dragonwilds.runescape.com/news/how-to-dedicated-servers) documents in-game moderation and warns that live INI changes are overwritten; [official dedicated-server repository](https://github.com/runescape/rsdw-dedicated) supplies the vendor's container/setup reference.
