#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p "${SWARM_HOME:?SWARM_HOME must be set}"
chmod 700 "$SWARM_HOME"
npm ci
npm run build
npm install --global @openai/codex@0.160.1
npx playwright install --with-deps chrome
printf '\nCubeFarm installed. Open forwarded port 4417 (keep it private).\nClaude login: node bin/cubefarm.js login\nCodex login: codex login --device-auth\n'
