# Contributing to ContractSentry

Thank you for your interest in contributing!

## Prerequisites

- [mise](https://mise.jdx.dev/getting-started.html) — manages Node, Python, pnpm, and uv

```bash
# Install mise (macOS / Linux)
curl https://mise.run | sh
```

## Setup

```bash
git clone https://github.com/contractsentry/contractsentry
cd contractsentry
bash scripts/init.sh
```

`scripts/init.sh` does the following:
1. `mise install` — pins Node 22, Python 3.12, pnpm 9, uv 0.11.12 from `.mise.toml`
2. `pnpm install` — installs turbo, biome, lefthook, changesets
3. `pnpm lefthook install` — wires pre-commit hooks from `lefthook.yml`

## Workflow

```bash
# Build all packages
pnpm turbo build

# Run all tests
pnpm turbo test

# Lint and typecheck
pnpm turbo lint typecheck

# Format (TypeScript / JSON)
pnpm format
```

## Repository Structure

```
scripts/
  init.sh         — one-shot dev environment setup
```

## Pre-commit Hooks

`lefthook.yml` runs the following checks on every commit:

| Hook | Glob | What it does |
|------|------|-------------|
| `biome-check` | `*.{ts,tsx,js,json}` | Lint + format TypeScript/JSON, auto-fixes staged files |
| `ty-check` | `*.py` | Type-check Python with `ty` |
| `ruff-check` | `*.py` | Lint + format Python, auto-fixes staged files |

## Making Changes

1. Create a feature branch from `main`
2. Write a failing test first (TDD)
3. Implement until the test passes
4. Run `pnpm turbo test`
5. Add a changeset: `pnpm changeset`
6. Open a pull request

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning npm packages.

```bash
pnpm changeset          # describe your change and select affected packages
pnpm changeset version  # bump versions (done by CI before release)
pnpm changeset publish  # publish to npm (done by CI on version tag)
```

## Commit Convention

```
<type>(<scope>): <subject>

Types:  feat | fix | chore | ci | test | docs | refactor
Scopes: core | repo
```

## Reporting Issues

Please open an issue on GitHub with:
- The OpenAPI spec snippet
- The code file snippet
- The command you ran
- Expected vs actual output
