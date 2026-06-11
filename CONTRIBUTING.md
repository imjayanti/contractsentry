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
git clone https://github.com/imjayanti/contractsentry
cd contractsentry
bash scripts/init.sh
```

`scripts/init.sh` does the following:
1. `mise install` — pins Node 22, Python 3.12, pnpm, uv from `.mise.toml`
2. `pnpm install` — installs turbo, biome, lefthook, changesets
3. `pnpm lefthook install` — wires pre-commit hooks from `lefthook.yml`

## Workflow

```bash
# Build all packages
pnpm build

# Run all TypeScript/CLI tests
pnpm test

# Run Python AI module tests
cd packages/ai && uv run pytest tests/ -v

# Lint and typecheck (TypeScript)
pnpm turbo lint typecheck

# Lint and typecheck (Python)
cd packages/ai && uvx ruff check contractsentry_ai/ && uv run ty check contractsentry_ai/

# Format (TypeScript / JSON)
pnpm format
```

## Repository Structure

```
packages/
  core/                     — domain types, analyzers, validator, reporter, orchestrator
    src/
      domain/               — Violation, FunctionShape, Errors, port interfaces
      infrastructure/
        analyzer/           — TreeSitterTypeScriptAnalyzer, TreeSitterPythonAnalyzer,
        |                     FileCodeAnalyzer, AiBridgeAnalyzer
        config/             — CsentryConfigLoader
        reporter/           — ConsoleReporter
        scanner/            — ScanOrchestrator
        spec/               — OpenApiSpecLoader, SchemaExtractor
        validator/          — ContractValidator
  cli/                      — csentry CLI
    src/
      bin.ts                — Commander entry point
      commands/
        check.ts            — runCheck logic (injectable deps for testing)
  ai/                       — contractsentry-ai Python module
    contractsentry_ai/
      analyzer.py           — msgspec structs + Anthropic tool use
      prompts.py            — prompt builder + report_violations tool definition
      __main__.py           — stdin/stdout subprocess entrypoint
    tests/
      test_analyzer.py      — pytest suite with mocked Anthropic responses
  action/
    action.yml              — GitHub Action composite wrapping csentry check

.github/
  workflows/
    ci.yml                  — build, test, lint, typecheck on push and PRs to main
    release.yml             — changesets version PR + npm publish on merge to main

examples/
  petstore/                 — OpenAPI spec + TypeScript routes used as test fixtures
  fastapi-demo/             — OpenAPI spec + FastAPI routes used as Python test fixtures

scripts/
  init.sh                   — one-shot dev environment setup
```

## Pre-commit Hooks

`lefthook.yml` runs the following checks in parallel on every commit:

| Hook | Glob | What it does |
|------|------|--------------|
| `biome-check` | `*.{ts,tsx,js,json}` | Lint + format TypeScript/JSON, auto-fixes staged files |
| `ty-check` | `packages/ai/**/*.py` | Type-check Python with `ty` (uses `packages/ai` venv) |
| `ruff-check` | `packages/ai/**/*.py` | Lint + format Python, auto-fixes staged files |
| `test` | always | Runs `pnpm turbo test` (all TypeScript/CLI tests) |
| `pytest` | `packages/ai/**/*.py` | Runs `pytest tests/` in the AI module |

## Making Changes

1. Create a feature branch from `main`
2. Write a failing test first (TDD)
3. Implement until the test passes
4. Run `pnpm test`
5. Add a changeset: `pnpm changeset`
6. Open a pull request

## CI

Two workflows run automatically:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push + PR to `main` | Installs, builds, tests, lints, typechecks |
| `release.yml` | push to `main` | Opens a Version PR when changesets are present; publishes to npm when that PR merges |

The release workflow requires these repository secrets:
- `NPM_TOKEN` — npm access token with publish rights (`GITHUB_TOKEN` is provided automatically)
- `ANTHROPIC_API_KEY` — required only for running `csentry check --ai` in CI

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning npm packages.

```bash
pnpm changeset          # describe your change and select affected packages
pnpm changeset version  # bump versions (done by CI before release)
pnpm changeset publish  # publish to npm (done by CI on version tag)
```

Use `patch` for bug fixes, `minor` for new features, `major` for breaking changes.

## Commit Convention

```
<type>(<scope>): <subject>

Types:  feat | fix | chore | ci | test | docs | refactor
Scopes: core | cli | repo
```

## Reporting Issues

Please open an issue on GitHub with:
- The OpenAPI spec snippet
- The code file snippet
- The command you ran
- Expected vs actual output
