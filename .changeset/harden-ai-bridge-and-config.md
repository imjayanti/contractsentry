---
"@contractsentry/core": patch
"@contractsentry/cli": patch
---

Harden AI bridge, fix config merging, expand HTTP method coverage, and surface AI explanations on violations.

- `AiBridgeAnalyzer`: add `python3`/`python` fallback, stdin error handler, and JSON parse guard
- `ScanOrchestrator`: use lowest 2xx schema for AI calls (deterministic), deduplicate AI calls per endpoint, and propagate `explanation` from AI violations onto `Violation`
- `Violation`: add optional `explanation` field
- `SchemaExtractor`: support `OPTIONS` and `TRACE` HTTP methods
- `check`: merge `strict`/`audit`/`ignore` from config with CLI flags; `--files` now accepts multiple glob patterns
- `bin`: version read from `package.json` instead of hardcoded `"0.0.0"`
