"""Tests for contractsentry_ai.analyzer — mocked Anthropic responses."""

import json
from unittest.mock import MagicMock, patch

import msgspec
import pytest

from contractsentry_ai.analyzer import AnalysisResult, Violation, analyze


def make_tool_use_block(violations: list[dict]) -> MagicMock:
    """Build a mock Anthropic ToolUseBlock for the report_violations tool."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = "report_violations"
    block.input = {"violations": violations}
    return block


def make_anthropic_response(violations: list[dict]) -> MagicMock:
    """Build a mock Anthropic API response with a tool use block."""
    response = MagicMock()
    response.stop_reason = "tool_use"
    response.content = [make_tool_use_block(violations)]
    return response


SAMPLE_PAYLOAD = {
    "protocol_version": 1,
    "endpoint": "GET /users/{user_id}",
    "schema": {
        "type": "object",
        "required": ["id", "name", "email"],
        "properties": {
            "id": {"type": "integer"},
            "name": {"type": "string"},
            "email": {"type": "string"},
        },
    },
    "code_snippet": (
        'async def get_user(user_id: int):\n    return {"id": user_id, "name": "Alice"}'
    ),
}


class TestAnalyze:
    def test_returns_violations_from_tool_use(self):
        mock_violations = [
            {
                "field": "email",
                "expected": "present",
                "found": "missing",
                "explanation": (
                    "The email field is required by the schema"
                    " but absent from the return value."
                ),
            }
        ]
        mock_response = make_anthropic_response(mock_violations)

        with patch("contractsentry_ai.analyzer._client") as mock_client:
            mock_client.messages.create.return_value = mock_response

            result = analyze(SAMPLE_PAYLOAD)

        assert isinstance(result, AnalysisResult)
        assert len(result.violations) == 1
        v = result.violations[0]
        assert v.field == "email"
        assert v.expected == "present"
        assert v.found == "missing"

    def test_returns_empty_violations_when_no_drift(self):
        mock_response = make_anthropic_response([])

        with patch("contractsentry_ai.analyzer._client") as mock_client:
            mock_client.messages.create.return_value = mock_response

            result = analyze(SAMPLE_PAYLOAD)

        assert result.violations == []

    def test_returns_multiple_violations(self):
        mock_violations = [
            {
                "field": "email",
                "expected": "present",
                "found": "missing",
                "explanation": "Missing email field.",
            },
            {
                "field": "id",
                "expected": "integer",
                "found": "string",
                "explanation": "id should be integer, found string '1'.",
            },
        ]
        mock_response = make_anthropic_response(mock_violations)

        with patch("contractsentry_ai.analyzer._client") as mock_client:
            mock_client.messages.create.return_value = mock_response

            result = analyze(SAMPLE_PAYLOAD)

        assert len(result.violations) == 2
        fields = [v.field for v in result.violations]
        assert "email" in fields
        assert "id" in fields

    def test_raises_on_unsupported_protocol_version(self):
        bad_payload = {**SAMPLE_PAYLOAD, "protocol_version": 99}
        with pytest.raises(ValueError, match="protocol_version"):
            analyze(bad_payload)

    def test_raises_on_missing_required_fields(self):
        with pytest.raises((KeyError, msgspec.ValidationError)):
            analyze({"protocol_version": 1})

    def test_calls_anthropic_with_correct_model(self):
        mock_response = make_anthropic_response([])

        with patch("contractsentry_ai.analyzer._client") as mock_client:
            mock_client.messages.create.return_value = mock_response

            analyze(SAMPLE_PAYLOAD)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert "claude" in call_kwargs["model"]

    def test_tool_definition_includes_report_violations(self):
        mock_response = make_anthropic_response([])

        with patch("contractsentry_ai.analyzer._client") as mock_client:
            mock_client.messages.create.return_value = mock_response

            analyze(SAMPLE_PAYLOAD)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        tool_names = [t["name"] for t in call_kwargs["tools"]]
        assert "report_violations" in tool_names


class TestViolationStruct:
    def test_violation_encodes_to_json(self):
        v = Violation(
            field="email",
            expected="present",
            found="missing",
            explanation="email is required",
        )
        encoded = msgspec.json.encode(v)
        decoded = json.loads(encoded)
        assert decoded["field"] == "email"
        assert decoded["expected"] == "present"

    def test_analysis_result_encodes_to_json(self):
        result = AnalysisResult(
            violations=[
                Violation(
                    field="id",
                    expected="integer",
                    found="string",
                    explanation="id drift",
                )
            ]
        )
        encoded = msgspec.json.encode(result)
        decoded = json.loads(encoded)
        assert len(decoded["violations"]) == 1
        assert decoded["violations"][0]["field"] == "id"
