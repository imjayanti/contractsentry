# ContractSentry

> Catch OpenAPI contract drift at dev time — before it hits production.

AI coding tools (Copilot, Cursor, Claude Code) generate code that silently drifts from your OpenAPI contracts. ContractSentry is an open-source CLI that validates your code against your spec and fails CI when drift is detected.

---

## Quickstart

---

## Installation

---

## Usage


### Exit codes


### Examples


---

## GitHub Actions

---

## Supported Languages

| Language   | Framework Support              | Status |
|------------|-------------------------------|--------|
| TypeScript | Express, Fastify, NestJS      | ✅ v0.1.0 |

---

## Packages

---

## Development

```bash
# Prerequisites: mise (manages Node, Python, pnpm, uv)
# Install mise: curl https://mise.run | sh

git clone https://github.com/contractsentry/contractsentry
cd contractsentry
bash scripts/init.sh   # installs Node 22, Python 3.12, pnpm 9, uv 0.11.12 + wires git hooks


# Build all packages
pnpm turbo build

# Run all tests
pnpm turbo test

```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution guidelines.

---

## License

MIT
