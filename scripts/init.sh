#!/usr/bin/env bash
# Run once after cloning: bash scripts/init.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "${CYAN}==>${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
die()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── 1. Prerequisites ────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v mise >/dev/null 2>&1 \
  || die "mise not found. Install it: https://mise.jdx.dev/getting-started.html"

command -v git >/dev/null 2>&1 \
  || die "git not found."

ok "Prerequisites met"

# ── 2. Install tool versions (.mise.toml) ───────────────────────────────────
step "Installing tool versions via mise"
mise install
ok "Node + Python + pnpm pinned"

# ── 3. Install workspace dependencies ───────────────────────────────────────
step "Installing pnpm workspace dependencies"
pnpm install
ok "node_modules ready"

# ── 4. Wire up git hooks ─────────────────────────────────────────────────────
step "Installing lefthook git hooks"
pnpm lefthook install
ok "pre-commit hooks active"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}ContractSentry dev environment ready.${NC}"
echo "Next: follow the Phase 1 commit in noble-gliding-starfish.md"
