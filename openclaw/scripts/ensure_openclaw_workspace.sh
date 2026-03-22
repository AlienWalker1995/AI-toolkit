#!/usr/bin/env bash
# Copies workspace templates to data/openclaw/workspace when missing.
# Run after scripts/ensure_dirs.sh. Linux/Mac; Windows uses ensure_openclaw_workspace.ps1.
set -euo pipefail

base="${BASE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
base="${base//\\/\/}"
data="${DATA_PATH:-$base/data}"
workspace="$data/openclaw/workspace"
templates="$base/openclaw/workspace"

files=(SOUL.md AGENTS.md TOOLS.md MEMORY.md USER.md IDENTITY.md HEARTBEAT.md)
for f in "${files[@]}"; do
  dst="$workspace/$f"
  if [[ ! -f "$dst" ]]; then
    src="$templates/$f"
    src_example="$templates/$f.example"
    if [[ -f "$src" ]]; then
      cp "$src" "$dst"
      echo "Copied $f to workspace"
    elif [[ -f "$src_example" ]]; then
      cp "$src_example" "$dst"
      echo "Copied $f.example to workspace as $f"
    fi
  fi
done
BASE_PATH="$base" DATA_PATH="$data" bash "$(dirname "${BASH_SOURCE[0]}")/upgrade_tools_md_from_example.sh"
echo "OpenClaw workspace ready."
