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

- http://localhost:18090 : real-game deployment (running after the 2026-09-23 administration/update tests); credentials/settings in the ignored .env.real.local.
- http://localhost:18089 : isolated lifecycle fixture; credentials/settings in the ignored .env.test.local.

Both test environments disable automatic updates. The production .env.example enables them by default. Use a real OWNER_ID and fresh passwords for Linux deployment; never reuse the synthetic test settings.

## GitHub workflow verification (2026-09-23 local time)

The complete Verify workflow was executed with act 0.2.89 on Docker Desktop, using its Ubuntu runner image. Both jobs passed: Actionlint 1.7.12, ShellCheck, syntax checks, 28 unit tests, both image builds, eight Docker integration checkpoints, Trivy scans and fixture-volume cleanup. CI now uses named volumes so Docker-in-Docker-style runner paths cannot accidentally refer to the wrong host directory.

Trivy 0.74.0 initially found four fixable HIGH vulnerabilities in npm bundled with the admin base image (brace-expansion, ip-address and tar). The runtime does not use npm or Yarn; removing these package managers cleared the gate. Both rebuilt images have zero fixable HIGH/CRITICAL findings under this policy. This is not a claim of zero vulnerabilities of every severity or coverage of the proprietary game downloaded at runtime.

GHCR, release and scheduled-audit workflow graphs passed act dry runs. Actual local OCI builds for both images succeeded; their archives were opened and checked for SPDX SBOM and SLSA v1 provenance statements. GitHub package authentication/publication, hosted artifact uploads, repository rules and remote code-scanning ingestion require a real GitHub run and were not claimed as locally tested. No images were pushed to GHCR.

The exact pinned Docker metadata action was executed with simulated main/stable/prerelease events and a local repository-metadata API fixture. All three tag sets passed, including protection of latest from prereleases. The release packaging helper ran in Linux; the ZIP contents, exclusion of local secrets and SHA256SUMS were verified.

CodeQL action v4.38.1 / CLI 2.27.0 completed locally for JavaScript, Python and GitHub Actions. The final SARIF reports contain **zero findings in all three languages**. Its initial Python finding identified an unnecessary all-interface bind in the synthetic fixture; that fixture now binds container loopback, and all eight Docker integration checks passed again. Real game and panel binding settings were not changed. Local CodeQL uses a synthetic analysis ID and upload=never; query execution is unchanged.

Six additional act checks of the actual GHCR publish/export expressions passed (game/admin for push, manual publish=true and manual publish=false). These caught and corrected GitHub expression empty-string fallback behavior so publish runs do not accidentally request an OCI-only export. No GHCR credentials or publication were used in these tests.


## Proxy, maintenance, progress and command verification (2026-09-23)

- The reverse-proxy regression first reproduced shared client lockout, then passed with explicit proxy trust. Tests cover untrusted forwarding spoofing, chain traversal, malformed headers, IPv4-mapped IPv6, canonical IPv6 and CIDR bounds. Password hashing now uses bounded asynchronous work.
- Maintenance regressions cover midnight wrapping, exclusive window ends, invalid intervals, persisted UI overrides and reset, automatic deferral without consuming cooldown, manual bypass, and delayed Steam/Docker responses that cross a window boundary. Existing two-hour/failure/manual-restart tests still pass.
- Manual Steam check endpoint tests cover authentication, origin rejection, concurrency, request throttling and no direct restart. Startup tests cover atomic stage writes, stale records, active-download restart protection and failures.
- Browser checks exercised Check Steam now against live Valve metadata, edited/saved 23:30-01:15 UTC, and confirmed it survived an admin-container restart. Mobile width 390 had no horizontal overflow. Expected unauthenticated HTTP 401 responses occurred during login/session reset; no JavaScript exceptions were observed.
- Rebuilt both images and exercised the actual game with UPDATE_ON_START=true: pre-update backup, successful Steam validation of build 25387240, persistent startup record, then healthy process/UDP sockets and ReadyToJoin. Automatic restarts remain disabled in the local real-test environment; startup validation is enabled.
- Actual game command probes and limitations are recorded in GAME-CAPABILITIES.md. No real account was available for player/moderation tests. The game and admin remain running on the isolated local deployment.

- Final complete Verify workflow passed under local act: **49 unit tests (41 Node, 8 Python)**, ShellCheck, Actionlint, both image builds, all eight Docker integration checkpoints and both Trivy gates (no fixable HIGH/CRITICAL findings). This rerun used the final maintenance-boundary fix. Log: ignored `test-results/verify-admin-improvements.log`. Earlier CodeQL results above belong to the previous workflow-validation run; CodeQL was not rerun for this change.
