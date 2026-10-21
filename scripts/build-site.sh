#!/usr/bin/env bash
# Copies the website into worker/public so the Worker can serve it.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf worker/public && mkdir -p worker/public/data
cp -r index.html icon.svg manifest.webmanifest due.json assets shared worker/public/
cp data/*.json worker/public/data/
[ -f config.json ] && cp config.json worker/public/ || true
echo "Built worker/public ($(find worker/public -type f | wc -l) files)"
