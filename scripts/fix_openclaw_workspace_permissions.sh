#!/usr/bin/env bash
# Re-run openclaw-workspace-sync so data/openclaw is owned by uid 1000 (node in openclaw-gateway).
set -euo pipefail
base="${BASE_PATH:-$(pwd)}"
cd "$base"
export BASE_PATH="$base"
bash "$base/openclaw/scripts/upgrade_tools_md_from_example.sh"
echo "Running openclaw-workspace-sync (TOOLS.md stub upgrade, chown 1000:1000 on data/openclaw)..."
docker compose run --rm openclaw-workspace-sync
echo "Done. Restart gateway if needed: docker compose up -d openclaw-gateway"
