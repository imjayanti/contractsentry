"""Tests for contractsentry_ai.prompts — language detection and prompt building."""

from contractsentry_ai.prompts import _detect_language, build_prompt


class TestDetectLanguage:
    def test_detects_python_from_def(self):
        snippet = "def get_user(user_id: int):\n    return {'id': user_id}"
        assert _detect_language(snippet) == "python"

    def test_detects_python_from_async_def(self):
        snippet = "async def get_user(user_id: int):\n    return {'id': user_id}"
        assert _detect_language(snippet) == "python"

    def test_detects_python_with_indented_def(self):
        snippet = "class Router:\n    def get_user(self):\n        pass"
        assert _detect_language(snippet) == "python"

    def test_detects_typescript_for_ts_code(self):
        snippet = "export async function getUser(id: number) {\n  return { id };\n}"
        assert _detect_language(snippet) == "typescript"

    def test_detects_typescript_for_empty_snippet(self):
        assert _detect_language("") == "typescript"

    def test_detects_typescript_when_def_is_not_a_function(self):
        snippet = "const defined = true;\nconst defaultValue = 0;"
        assert _detect_language(snippet) == "typescript"


class TestBuildPrompt:
    def test_uses_python_fence_for_python_snippet(self):
        snippet = "def get_user():\n    return {}"
        prompt = build_prompt("GET /users", {}, snippet)
        assert "```python" in prompt

    def test_uses_typescript_fence_for_ts_snippet(self):
        snippet = "export function getUser() { return {}; }"
        prompt = build_prompt("GET /users", {}, snippet)
        assert "```typescript" in prompt

    def test_includes_endpoint_in_prompt(self):
        prompt = build_prompt("GET /users/{id}", {}, "def f(): pass")
        assert "GET /users/{id}" in prompt

    def test_includes_schema_json_in_prompt(self):
        schema = {"type": "object", "required": ["id"]}
        prompt = build_prompt("GET /users", schema, "def f(): pass")
        assert '"required"' in prompt
        assert '"id"' in prompt
