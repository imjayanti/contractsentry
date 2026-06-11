# @contractsentry/core

Core library for ContractSentry — analyzers, validator, reporters, and orchestrator.

This package is consumed by `@contractsentry/cli`. Use it directly only if you are building a custom integration or extending ContractSentry's behaviour.

## Installation

```bash
npm install @contractsentry/core
```

## Programmatic usage

```typescript
import { ScanOrchestrator, ConsoleReporter } from "@contractsentry/core";

const orchestrator = new ScanOrchestrator();
const reporter = new ConsoleReporter();

const violations = await orchestrator.scan({
  specPath: "openapi.yaml",
  filePaths: ["src/routes/users.ts"],
  useAi: false,
});

reporter.report(violations);

if (violations.some((v) => !v.suppressed && v.severity === "error")) {
  process.exit(1);
}
```

With AI-powered drift detection:

```typescript
const violations = await orchestrator.scan({
  specPath: "openapi.yaml",
  filePaths: ["src/routes/users.ts"],
  useAi: true, // requires ANTHROPIC_API_KEY and contractsentry-ai installed
});
```

## Exports

### Classes

| Class | Description |
|-------|-------------|
| `ScanOrchestrator` | Loads the spec, analyses files, validates shapes and request params, and returns violations |
| `ConsoleReporter` | Prints violations to stdout; shows `explanation` on a second line for AI-sourced violations |
| `JsonReporter` | Writes `{ violations: [...] }` JSON to stdout — use with `--format json` or piping |
| `FileCodeAnalyzer` | Analyses a TypeScript or Python source file and extracts function shapes |
| `ContractValidator` | Validates a function's return shape or request params against an OpenAPI schema object |
| `OpenApiSpecLoader` | Loads and dereferences an OpenAPI 3.x spec (YAML or JSON) |
| `SchemaExtractor` | Extracts per-endpoint 2xx response schemas and request body schemas from a parsed spec |
| `CsentryConfigLoader` | Loads and evaluates `csentry.config.ts` from a directory |

### Error classes

| Class | Thrown when |
|-------|-------------|
| `SpecLoadError` | The spec file cannot be loaded or is not a valid OpenAPI 3.x document |
| `AnalysisError` | A source file cannot be read |
| `SubprocessError` | The Python AI subprocess exits with a non-zero code or returns invalid JSON |

### Types

| Type | Description |
|------|-------------|
| `Violation` | A single contract violation — `file`, `line`, `endpoint`, `field`, `expected`, `found`, `severity` (`"error"` or `"warn"`), `suppressed`, and optional `explanation` (set by AI violations) |
| `FunctionShape` | The extracted return shape, parameter shape, dynamic flag, endpoint guess, status hint, and suppression state for a function |
| `CsentryConfig` | Shape of `csentry.config.ts` — `spec`, `files`, `ignore`, `strict`, `audit` |
| `ScanInput` | Input to `ScanOrchestrator.scan()` — `specPath`, `filePaths`, `useAi` |

### Interfaces

| Interface | Description |
|-----------|-------------|
| `IReporter` | `report(violations: Violation[]): void` — implement to build a custom reporter |
| `IConfigLoader` | `load(dir: string): Promise<CsentryConfig \| null>` — implement to load config from a custom source |

## More

Full documentation and source at [github.com/imjayanti/contractsentry](https://github.com/imjayanti/contractsentry).

## License

MIT
