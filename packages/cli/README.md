# @contractsentry/cli

> Catch OpenAPI contract drift at dev time — before it hits production.

Validates TypeScript and Python function return shapes and request parameters against your OpenAPI spec, and fails CI when drift is detected.

## Installation

```bash
npm install -g @contractsentry/cli

# or run without installing
npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

## Usage

```bash
csentry check [options]
```

| Option | Description |
|--------|-------------|
| `--spec <path>` | Path to OpenAPI spec (YAML or JSON) |
| `--files <glob...>` | One or more glob patterns of files to scan |
| `--ai` | Enable AI-powered drift detection via Anthropic (requires `ANTHROPIC_API_KEY`) |
| `--audit` | Report violations but always exit `0` — for gradual CI adoption |
| `--strict` | Exit `1` on any violation including `warn` severity |
| `--format <fmt>` | Output format: `table` (default) or `json` |

CLI flags take precedence over config file values when both are present.

## Config file

Create `csentry.config.ts` at the project root to avoid repeating flags on every run:

```typescript
// csentry.config.ts
export default {
  spec: "openapi.yaml",
  files: ["src/**/*.ts", "lib/**/*.ts"],
  ignore: ["src/generated/**", "**/*.d.ts"],
  strict: false,
  audit: false,
};
```

With a config file in place, `csentry check` with no flags is sufficient.

## Annotating your code

### TypeScript

Add `// @route <METHOD> <PATH>` above a function to map it to an OpenAPI endpoint:

```typescript
// @route GET /users/{id}
export function getUser(id: number) {
  return { id, name: "Alice" }; // ← missing `email` — spec requires it
}

// @route POST /users
export function createUser(name: string) { // ← missing `email` param — requestBody requires it
  return { id: 1, name, email: "" };
}
```

Functions that return a non-static expression receive a `warn` rather than being skipped silently:

```typescript
// @route GET /users/{id}
export function getUser(id: number) {
  return buildUser(id); // ← warn: dynamic expression, cannot analyse statically
}
```

### Python (FastAPI / Flask)

Route decorators are read directly — no annotation needed:

```python
@router.get("/users/{user_id}")
async def get_user(user_id: int):
    return {"id": user_id, "name": "Alice"}  # ← missing `email`

@router.post("/users")
async def create_user(name: str, email: str):
    return {"id": "1", "name": name}  # ← id should be integer, email missing
```

Flask `@app.route` with a `methods` list is also supported.

### Suppressing violations

Place `// csentry-ignore` (TypeScript) or `# csentry-ignore` (Python) on the line before the function to opt it out of all validation:

```typescript
// csentry-ignore
export function deleteUser(id: number) {
  return { deleted: id };
}
```

```python
# csentry-ignore
@router.delete("/users/{user_id}")
async def delete_user(user_id: int):
    return {"deleted": user_id}
```

## AI-powered detection

Pass `--ai` to layer Anthropic LLM analysis on top of static checks. The AI catches semantic drift that heuristics miss — wrong field semantics, incorrect types on dynamic values, and constraint violations. Each AI violation includes a human-readable explanation:

```bash
ANTHROPIC_API_KEY=sk-... csentry check --spec openapi.yaml --files 'src/**/*.ts' --ai
```

```
src/routes/users.ts:12  error  POST /users  field "email" expected present, found missing
  → The email field is marked required in the requestBody schema but is not returned in the response object.
```

AI violations are deduplicated against static findings, so the same issue is never reported twice.

## Output

```
src/routes/users.ts:5   warn   GET /users/{id}  field "(return value)" expected static object literal, found dynamic expression
src/routes/users.ts:12  error  POST /users      field "email" expected present, found missing

Found 2 violations
```

Pass `--format json` to get machine-readable output:

```bash
csentry check --spec openapi.yaml --files 'src/**/*.ts' --format json
```

A clean scan produces no output and exits `0`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No `error`-severity violations (warnings do not trigger a non-zero exit unless `--strict` is set) |
| `1` | One or more `error`-severity violations (or any violation with `--strict`) |
| `2` | Unexpected error (missing spec, bad config, etc.) |

## GitHub Actions

```yaml
- name: Check contracts
  run: npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

The step exits non-zero on violations, failing the workflow automatically. For gradual CI adoption, add `--audit` to report without blocking:

```yaml
- name: Audit contracts (non-blocking)
  run: npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts' --audit
```

## More

Full documentation and source at [github.com/imjayanti/contractsentry](https://github.com/imjayanti/contractsentry).

## License

MIT
