# @contractsentry/core

Core library for ContractSentry — analyzers, validator, reporter, and orchestrator.

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
});

reporter.report(violations);

if (violations.some((v) => !v.suppressed)) {
  process.exit(1);
}
```

## Exports

### Classes

| Class | Description |
|-------|-------------|
| `ScanOrchestrator` | Loads spec, analyses files, validates shapes, returns violations |
| `ConsoleReporter` | Prints violations to stdout with a summary line |
| `FileCodeAnalyzer` | Analyses a TypeScript file and extracts function shapes |
| `ContractValidator` | Validates a function shape against an OpenAPI schema |
| `OpenApiSpecLoader` | Loads and parses an OpenAPI 3.x spec (YAML or JSON) |
| `SchemaExtractor` | Extracts per-endpoint 2xx response schemas from a parsed spec |
| `CsentryConfigLoader` | Loads `csentry.config.ts` from a directory |

### Error classes

| Class | Thrown when |
|-------|-------------|
| `SpecLoadError` | The spec file cannot be loaded or is not OpenAPI 3.x |
| `AnalysisError` | A source file cannot be read or analysed |

### Types

| Type | Description |
|------|-------------|
| `Violation` | A single contract violation with file, line, endpoint, and field |
| `FunctionShape` | The extracted return shape and metadata for a function |
| `CsentryConfig` | Shape of `csentry.config.ts` |
| `ScanInput` | Input to `ScanOrchestrator.scan()` |

## More

Full documentation and source at [github.com/imjayanti/contractsentry](https://github.com/imjayanti/contractsentry).

## License

MIT
