#!/bin/bash
set -Eeuo pipefail
mkdir -p dist
git archive --format=zip --output=dist/dragonwilds-deployment.zip HEAD
(cd dist && sha256sum dragonwilds-deployment.zip > SHA256SUMS)
