#!/bin/bash
set -Eeuo pipefail
mkdir -p test-results/ci
status=0
for component in server admin; do
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
        -v dragonwilds-trivy-cache:/root/.cache/ \
        aquasec/trivy:0.74.0 image --no-progress --scanners vuln --severity HIGH,CRITICAL \
        --ignore-unfixed --exit-code 1 --format json "dragonwilds-${component}:local" \
        > "test-results/ci/${component}-vulnerabilities.json" || status=1
done
exit "$status"
