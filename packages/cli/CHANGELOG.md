# @contractsentry/cli

## 0.3.4

### Patch Changes

- 46528d4: Sync contractsentry-ai Python package to 0.5.0

## 0.3.3

### Patch Changes

- e434024: Add JavaScript file support and Express `.route()` chaining detection

  `@contractsentry/core` now detects routes defined via Express-style `.route('/path').get(handler).post(handler)` chaining, including arbitrarily deep chains. The TypeScript/JavaScript analyzer already parsed `.js` files correctly; CLI help text has been updated to reflect this.

- Updated dependencies [e434024]
  - @contractsentry/core@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [38552cd]
  - @contractsentry/core@0.4.0

## 0.3.1

### Patch Changes

- fd717c1: Harden AI bridge, fix config merging, expand HTTP method coverage, and surface AI explanations on violations.

  - `AiBridgeAnalyzer`: add `python3`/`python` fallback, stdin error handler, and JSON parse guard
  - `ScanOrchestrator`: use lowest 2xx schema for AI calls (deterministic), deduplicate AI calls per endpoint, and propagate `explanation` from AI violations onto `Violation`
  - `Violation`: add optional `explanation` field
  - `SchemaExtractor`: support `OPTIONS` and `TRACE` HTTP methods
  - `check`: merge `strict`/`audit`/`ignore` from config with CLI flags; `--files` now accepts multiple glob patterns
  - `bin`: version read from `package.json` instead of hardcoded `"0.0.0"`

- Updated dependencies [fd717c1]
  - @contractsentry/core@0.3.1

## 0.3.0

### Minor Changes

- cb1e7c4: Add Python analyzer, AI-powered drift detection, and GitHub Action

  - Analyze FastAPI and Flask routes via tree-sitter Python grammar — extracts return shapes from decorated functions, detects dynamic returns, and respects `# csentry-ignore` suppression
  - Dispatch TypeScript vs Python analysis automatically in `FileCodeAnalyzer` based on file extension
  - Add `AiBridgeAnalyzer` that spawns `python -m contractsentry_ai` as a subprocess and merges LLM violations with static findings, deduplicating by `(endpoint, field)`
  - Add `--ai` flag to `csentry check` to enable AI-powered detection (requires `ANTHROPIC_API_KEY`)
  - Export `AiBridgeAnalyzer` and `AiViolation` from the public API
  - Read each source file once in `ScanOrchestrator` and pass the content to both static and AI analysis

- 36e2905: Add schema composition, enum validation, and nested return shape analysis

  - Resolve allOf / oneOf / anyOf schema composition when extracting OpenAPI schemas
  - Validate nested object fields with dot-notation field names in violations
  - Validate array response items against the spec's items schema
  - Detect enum violations when a string literal return value is not in the spec's enum array
  - Detect return shapes from nested blocks (if-else, switch, try) — not just top-level returns
  - Export FieldShape and FieldShapeRecord types from the public API

### Patch Changes

- Updated dependencies [cb1e7c4]
- Updated dependencies [36e2905]
  - @contractsentry/core@0.3.0

## 0.2.0

### Minor Changes

- c0396c9: Add dynamic return detection, request body validation, and exit-code refinement

### Patch Changes

- Updated dependencies [c0396c9]
- Updated dependencies [fabbfc4]
  - @contractsentry/core@0.2.0

## 0.1.0

### Minor Changes

- 2a41138: Initial release of ContractSentry v0.1.0.

  Validates TypeScript function return shapes against OpenAPI 3.x specs at dev time and in CI. Detects missing required fields, reports violations with file/line/endpoint context, and exits non-zero when drift is found.

### Patch Changes

- Updated dependencies [2a41138]
  - @contractsentry/core@0.1.0
