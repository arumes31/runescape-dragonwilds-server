# GitHub workflows

The workflows target GitHub-hosted Ubuntu runners and Linux amd64 containers. Every external JavaScript action is pinned to a verified release commit. Dependabot proposes weekly GitHub Actions and Docker base-image updates; it does not merge automatically.

| Workflow | When it runs | What it checks or produces |
| --- | --- | --- |
| Verify | Every branch push, PR, manual run, and calls from other workflows | Actionlint, ShellCheck, Python/JavaScript syntax, unit tests, both Docker builds, isolated Docker lifecycle integration and vulnerability scans. |
| GHCR images | Main push, `v*` tag push, manual run | Requires Verify, then builds game/admin images with SBOM and provenance. Manual runs default to **no publication** and upload OCI archives. |
| CodeQL | PR, main push, weekly, manual | Security analysis of JavaScript, Python and GitHub Actions. Requires GitHub Code Security for private repositories. |
| Scheduled container audit | Weekly, manual | Rebuilds and runs Verify against the current vulnerability database so new advisories surface without a code change. |
| Release deployment archive | Published release, manual | Requires Verify, packages tracked source, creates SHA256SUMS; published releases receive both files. |
| Dependabot configuration | Weekly | Updates pinned Actions and the two Docker base images. |

The old Docker Hub developer/release publishers have been replaced. Docker Hub credentials are no longer needed. No workflow deploys or restarts a user's game server.

## GHCR publication

Push this branch to **your own GitHub repository** and merge the tested changes into `main`. The upstream remote in this local checkout is not a destination you automatically own.

The workflow uses the repository's `GITHUB_TOKEN` with `packages: write` only in the image job. Package names are lowercased:

- `ghcr.io/OWNER/REPOSITORY` (game)
- `ghcr.io/OWNER/REPOSITORY-admin` (panel)

Main builds receive `dev` and `sha-<full commit>` tags. A stable `v1.2.3` tag produces `1.2.3`, `1.2`, `latest` and a SHA tag. Prereleases receive their prerelease version and SHA; they never move `latest`. Pin a digest for reproducible deployments and rollback. A manual Actions run defaults to `publish=false`; check it only when publication is intended.

GHCR packages may initially be private. Set package visibility/access as appropriate in GitHub. For an existing package, grant this repository Actions access. The workflow adds OCI source/revision/license labels and BuildKit SLSA provenance plus an SPDX SBOM.

To use published images, set these in `.env`:

```dotenv
GAME_IMAGE=ghcr.io/your-owner/your-repository:1.2.3
ADMIN_IMAGE=ghcr.io/your-owner/your-repository-admin:1.2.3
```

Then run `docker compose pull` and `docker compose up -d --no-build`. To roll back, select the previous image digest/version and recreate the containers; back up world data before changing versions because game save formats may not be backward-compatible. `scripts/deploy.sh` remains the source-rebuild path.

## Local verification

Run ordinary checks on Linux (Node 24, Python 3.11+, Docker Compose 2.24.4+):

```bash
bash scripts/ci-checks.sh
shellcheck -x -P SCRIPTDIR scripts/*.sh
docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.12
python3 tests/prepare_fixture.py
docker compose --env-file .env.test.local build --pull
docker compose --env-file .env.test.local up -d --wait --wait-timeout 150
python3 tests/integration.py
bash scripts/ci-scan-images.sh
```

The vulnerability gate fails on **fixable HIGH/CRITICAL** findings or scanner errors. It writes JSON reports; no vulnerability allowlist is used. Trivy caches its database in the `dragonwilds-trivy-cache` volume. Lower severity and currently unfixable advisories do not block this gate. The scanner version is pinned in `scripts/ci-scan-images.sh` and should be reviewed periodically.

To execute jobs with [act](https://nektosact.com/), using Docker Desktop's Linux engine on Windows:

```powershell
act workflow_dispatch -W .github/workflows/verify.yml `
  -P ubuntu-latest=catthehacker/ubuntu:act-latest `
  --container-daemon-socket /var/run/docker.sock `
  --container-architecture linux/amd64 --env ACT=true --use-new-action-cache
```

The CI integration job uses `docker-compose.ci.yml` and named volumes, so the Docker daemon does not need access to paths inside the act runner. It controls only the `dragonwilds-test` fixture project and removes its named volumes after the test. Do not put real saves in that project. Artifact uploads are omitted locally; tests and security gates remain enabled. CodeQL disables remote result uploads under act and uses a local analysis ID because act has no GitHub workflow-run record. All queries still run. Do not reuse a stale CodeQL runner/database between test invocations.

For publication planning, use `act workflow_dispatch -W .github/workflows/ghcr.yml -n --input publish=false --env ACT=true --use-new-action-cache`. GitHub tokens, hosted artifact APIs and GHCR permissions are only fully verifiable in GitHub. Do not pass a production token merely to test locally.

Configure repository branch protection/rulesets to require Verify and CodeQL checks and a review before merging. Also require acceptable CodeQL alert severity in a code-scanning ruleset; a successful analysis job alone does not mean zero alerts. Workflow files cannot enable repository rules, GitHub Code Security, package permissions or visibility by themselves. No remote settings have been changed by this work.

References: [GitHub publishing containers](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images), [Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/), [CodeQL workflow configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options), [Trivy container scanning](https://trivy.dev/docs/latest/target/container_image/).
