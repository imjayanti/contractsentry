# ContractSentry

> Catch OpenAPI contract drift at dev time — before it hits production.

AI coding tools (Copilot, Cursor, Claude Code) generate code that silently drifts from your OpenAPI contracts. ContractSentry is an open-source CLI that validates your TypeScript return shapes against your spec and fails CI when drift is detected.

---

## Quickstart

```bash
npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

---

## Installation

```bash
# Global install
npm install -g @contractsentry/cli

# Or run without installing
npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

---

## Usage

```
csentry check [options]
```

| Option | Description |
|--------|-------------|
| `--spec <path>` | Path to your OpenAPI spec (YAML or JSON) |
| `--files <glob>` | Glob pattern of TypeScript files to scan |

Options can also be set in a `csentry.config.ts` at the project root, which supports multiple glob patterns:

```typescript
// csentry.config.ts
export default {
  spec: "openapi.yaml",
  files: ["src/**/*.ts", "lib/**/*.ts"],
};
```

When a config file is present, running `csentry check` with no flags is sufficient.

### Annotating your code

ContractSentry reads `// @route <METHOD> <PATH>` comments to map a function to an OpenAPI endpoint:

```typescript
// @route GET /users/{id}
export function getUser(id: number) {
  return { id, name: "Alice" }; // ← missing `email` — spec requires it
}
```

To opt a specific function out of validation, add `// csentry-ignore` on the line before the function:

```typescript
// csentry-ignore
export function deleteUser(id: number) {
  return { deleted: id };
}
```

### Output

```
src/routes/users.ts:5  error  GET /users/{id}  field "email" expected present, found missing
src/routes/users.ts:18  error  POST /users  field "email" expected present, found missing

Found 2 violations
```

A clean scan produces no output and exits `0`.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No violations (or all suppressed) |
| `1` | One or more contract violations |
| `2` | Unexpected error (missing spec, config syntax error, etc.) |

---

## GitHub Actions

```yaml
- name: Check contracts
  run: npx @contractsentry/cli check
```

Or with explicit options (no config file needed):

```yaml
- name: Check contracts
  run: npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

---

## Supported Languages

| Language   | Framework Support         | Status    |
|------------|--------------------------|-----------|
| TypeScript | Express, Fastify, NestJS | ✅ v0.1.0 |

---

## Packages

| Package | Description |
|---------|-------------|
| [`@contractsentry/cli`](packages/cli) | `csentry` CLI — the main entry point |
| [`@contractsentry/core`](packages/core) | Analyzers, validator, reporter, orchestrator |

---

## Development

```bash
# Prerequisites: mise (manages Node, Python, pnpm, uv)
# Install mise: curl https://mise.run | sh

git clone https://github.com/contractsentry/contractsentry
cd contractsentry
bash scripts/init.sh   # installs toolchain + wires git hooks

# Build all packages
pnpm build

# Run all tests
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution guidelines.

---

## License

MIT
