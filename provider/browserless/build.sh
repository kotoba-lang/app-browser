#!/usr/bin/env bash
set -euo pipefail

# Bazel runs this with `chdir = package_name()` so we're already in the project dir.

# Install deps deterministically as best-effort (no lock file committed yet).
# Critical: do NOT download browsers here; we rely on the Playwright base image.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if command -v npm >/dev/null 2>&1; then
  npm install
  npm run build
  npm prune --omit=dev
else
  echo "npm is required" >&2
  exit 1
fi

