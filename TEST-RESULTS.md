# Local verification report

Verified on 2026-09-22 UTC (September 22-23 locally) using Docker Desktop's Linux engine on Windows x86_64 (Docker 29.8, Compose 5.5), Node 24 and Python 3.14. The separate Linux server was not accessed or deployed, per request.

## Passing checks

- Both game and admin images built successfully, including downloading Valve SteamCMD and pinned DepotDownloader 3.4.0.
- 21 Node tests: authentication, cookie flags, session expiry, rate limiting, origin protection, container identity restrictions, log redaction, action errors/concurrency, resource metrics, Steam metadata, incomplete manifests, persisted two-hour automatic cooldown, failed attempts, shared daily/Steam cooldown, and repeated manual restarts that neither consume nor reset it.
- 7 Python tests: config validation, literal environment values, preserving GUID/known players/custom sections, manual INI preservation, backup contents and retention.
- ShellCheck passed for all shell scripts. JavaScript syntax and Git whitespace checks passed.
- Eight live Docker integration checkpoints passed against an explicitly labeled fixture: health, authenticated/redacted logs, restart, SIGTERM and identity/ban persistence, stop, start, resource metrics and logout.
- Chrome desktop and 390-pixel mobile checks: password login, actual button/confirmation restart, status/log polling, log filtering, version display and responsive layout. No horizontal overflow at 390 pixels. No JavaScript exceptions observed. Initial unauthenticated status requests correctly return HTTP 401.

## Real game verification

Downloaded the actual app 4019830 payload (5,483,743,730 bytes uncompressed) and validated it through SteamCMD. The installed appmanifest reports StateFlags=4 and build **25387240**. Independent live Steam metadata reports the same build; both values were displayed in the real admin UI.

The real server created and loaded SmokeTestWorld, established an EOS session and logged ReadyToJoin=1. The health check passed with UDP **27777 and 28888** bound. Testing exposed a real custom-port bug: setting only -Port changes the game socket but leaves the beacon at 8888. The launcher now sets OnlineBeaconHost.ListenPort explicitly, and the fixture validates both launch arguments to catch regressions.

A real manual restart was triggered through the browser confirmation dialog. The Docker start timestamp changed, health returned to healthy, and ServerGuid survived. After graceful shutdown, an offline archive was created and verified to contain the saved world and configuration. Real-game data is retained at D:/DragonwildsTest/server-files, outside the source tree.

## Limits and remaining verification

- The owner ID is deliberately synthetic because no in-game Player ID was available. A real player's join, ownership, moderation, multiplayer behavior and external NAT/firewall routing remain **unverified**. ReadyToJoin and Docker health are not substitutes for a client joining.
- Real Steam download/validation and live version lookup passed. No new Valve release occurred during testing; new-version decisions, two-hour boundary behavior and failure handling were tested with controlled providers rather than claiming a live patch rollout.
- The proprietary game logs content/navigation warnings and errors while reaching readiness. This project does not fix game-engine defects or native ARM support.
- Reverse-proxy origin rejection and Secure cookies were tested at the HTTP application level. A production TLS proxy/certificate was not deployed on this PC.
- CI configuration was added; remote GitHub Actions execution was not triggered. Upstream issues/PRs were reviewed and applicable fixes implemented locally, not closed/merged upstream.

## Local panels

- http://localhost:18090 : real-game deployment (game stopped after the smoke test; panel stays available); credentials/settings in the ignored .env.real.local.
- http://localhost:18089 : isolated lifecycle fixture; credentials/settings in the ignored .env.test.local.

Both test environments disable automatic updates. The production .env.example enables them by default. Use a real OWNER_ID and fresh passwords for Linux deployment; never reuse the synthetic test settings.
