---
"@contractsentry/core": minor
"@contractsentry/cli": minor
---

Add route chaining detection, optional field type checking, Python prefix support, and watch mode

`@contractsentry/core`: detect Express `.route('/path').METHOD(handler)` chaining; fix false positives from non-router call chains; type-check optional response fields against spec (not just required ones); detect `APIRouter(prefix=...)` and annotated assignments in Python; support `# csentry-prefix` file-level annotation for cross-file `include_router` mounting.

`@contractsentry/cli`: add `--watch` flag to re-run on file changes with debounce; watches source files, spec, and `csentry.config.ts`; exits cleanly on Ctrl+C.
