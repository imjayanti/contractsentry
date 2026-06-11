"""LLM drift detection via Anthropic structured tool use."""

from __future__ import annotations

from collections.abc import Sequence

import anthropic
import msgspec

from contractsentry_ai.prompts import REPORT_VIOLATIONS_TOOL, build_prompt

SUPPORTED_PROTOCOL_VERSIONS = {1}
MODEL = "claude-haiku-4-5-20251001"
_client = anthropic.Anthropic()


class Violation(msgspec.Struct):
    field: str
    expected: str
    found: str
    explanation: str


class AnalysisResult(msgspec.Struct):
    violations: list[Violation]


class _Payload(msgspec.Struct):
    protocol_version: int
    endpoint: str
    schema: dict
    code_snippet: str


def analyze(raw_payload: dict) -> AnalysisResult:
    """Run AI drift detection for one endpoint.

    Args:
        raw_payload: Dict with protocol_version, endpoint, schema, code_snippet.

    Returns:
        AnalysisResult with zero or more Violations.

    Raises:
        ValueError: If protocol_version is not supported.
        msgspec.ValidationError: If the payload is malformed.
    """
    payload = msgspec.convert(raw_payload, _Payload)

    if payload.protocol_version not in SUPPORTED_PROTOCOL_VERSIONS:
        raise ValueError(
            f"Unsupported protocol_version {payload.protocol_version}. "
            f"Expected one of: {sorted(SUPPORTED_PROTOCOL_VERSIONS)}"
        )

    prompt = build_prompt(payload.endpoint, payload.schema, payload.code_snippet)

    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=[REPORT_VIOLATIONS_TOOL],
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": prompt}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "report_violations":
            tool_input: dict[str, object] = dict(block.input)  # type: ignore[arg-type]
            raw_violations = tool_input.get("violations")
            items: Sequence[object] = (
                raw_violations if isinstance(raw_violations, list) else []
            )
            violations = [msgspec.convert(item, Violation) for item in items]
            return AnalysisResult(violations=violations)

    return AnalysisResult(violations=[])
