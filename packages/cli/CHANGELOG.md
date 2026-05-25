# @contractsentry/cli

## 0.3.0

### Minor Changes

- 36e2905: Add schema composition, enum validation, and nested return shape analysis

  - Resolve allOf / oneOf / anyOf schema composition when extracting OpenAPI schemas
  - Validate nested object fields with dot-notation field names in violations
  - Validate array response items against the spec's items schema
  - Detect enum violations when a string literal return value is not in the spec's enum array
  - Detect return shapes from nested blocks (if-else, switch, try) — not just top-level returns
  - Export FieldShape and FieldShapeRecord types from the public API

### Patch Changes

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
