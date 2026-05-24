# @contractsentry/cli

> Catch OpenAPI contract drift at dev time — before it hits production.

Validates TypeScript function return shapes and request parameters against your OpenAPI spec and fails CI when drift is detected.

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

Opt a function out of validation entirely with `// csentry-ignore`:

```typescript
// csentry-ignore
export function deleteUser(id: number) {
  return { deleted: id };
}
```

## Output

```
src/routes/users.ts:5   warn   GET /users/{id}  field "(return value)" expected static object literal, found dynamic expression
src/routes/users.ts:12  error  POST /users      field "email" expected present, found missing

Found 2 violations
```

A clean scan produces no output and exits `0`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No `error`-severity violations (warnings do not trigger a non-zero exit) |
| `1` | One or more `error`-severity violations |
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
