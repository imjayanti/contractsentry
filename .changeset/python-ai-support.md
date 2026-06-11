---
"@contractsentry/core": minor
"@contractsentry/cli": minor
---

Add Python analyzer, AI-powered drift detection, and GitHub Action

- Analyze FastAPI and Flask routes via tree-sitter Python grammar — extracts return shapes from decorated functions, detects dynamic returns, and respects `# csentry-ignore` suppression
- Dispatch TypeScript vs Python analysis automatically in `FileCodeAnalyzer` based on file extension
- Add `AiBridgeAnalyzer` that spawns `python -m contractsentry_ai` as a subprocess and merges LLM violations with static findings, deduplicating by `(endpoint, field)`
- Add `--ai` flag to `csentry check` to enable AI-powered detection (requires `ANTHROPIC_API_KEY`)
- Export `AiBridgeAnalyzer` and `AiViolation` from the public API
- Read each source file once in `ScanOrchestrator` and pass the content to both static and AI analysis
