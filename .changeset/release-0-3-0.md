---
"@contractsentry/core": minor
"@contractsentry/cli": minor
---

Add schema composition, enum validation, and nested return shape analysis

- Resolve allOf / oneOf / anyOf schema composition when extracting OpenAPI schemas
- Validate nested object fields with dot-notation field names in violations
- Validate array response items against the spec's items schema
- Detect enum violations when a string literal return value is not in the spec's enum array
- Detect return shapes from nested blocks (if-else, switch, try) — not just top-level returns
- Export FieldShape and FieldShapeRecord types from the public API
