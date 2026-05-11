# @contractsentry/cli

> Catch OpenAPI contract drift at dev time — before it hits production.

Validates TypeScript function return shapes against your OpenAPI spec and fails CI when drift is detected.

## Installation

```bash
npm install -g @contractsentry/cli

# or run without installing
npx @contractsentry/cli check --spec openapi.yaml --files 'src/**/*.ts'
```

## Usage

```bash
csentry check --spec openapi.yaml --files 'src/**/*.ts'
```

Or with a `csentry.config.ts` at the project root:

```typescript
export default {
  spec: "openapi.yaml",
  files: ["src/**/*.ts"],
};
```

```bash
csentry check
```

## Annotating your code

Add `// @route <METHOD> <PATH>` above a function to map it to an OpenAPI endpoint:

```typescript
// @route GET /users/{id}
export function getUser(id: number) {
  return { id, name: "Alice" }; // ← missing `email` — spec requires it
}
```

Opt a function out of validation with `// csentry-ignore`:

```typescript
// csentry-ignore
export function deleteUser(id: number) {
  return { deleted: id };
}
```

## Output

```
src/routes/users.ts:5  error  GET /users/{id}  field "email" expected present, found missing

Found 1 violation
```

A clean scan produces no output and exits `0`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No violations (or all suppressed) |
| `1` | One or more contract violations |
| `2` | Unexpected error (missing spec, bad config, etc.) |

## GitHub Actions

```yaml
- name: Check contracts
  run: npx @contractsentry/cli check
```

The step exits non-zero on violations, failing the workflow automatically.

## More

Full documentation and source at [github.com/imjayanti/contractsentry](https://github.com/imjayanti/contractsentry).

## License

MIT
