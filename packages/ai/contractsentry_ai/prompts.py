"""Prompt builder for the Anthropic API call."""

from __future__ import annotations

import json

from anthropic.types import ToolParam


def _detect_language(code_snippet: str) -> str:
    lines = code_snippet.splitlines()
    if any(
        line.lstrip().startswith("def ") or line.lstrip().startswith("async def ")
        for line in lines
    ):
        return "python"
    return "typescript"


def build_prompt(endpoint: str, schema: dict, code_snippet: str) -> str:
    schema_json = json.dumps(schema, indent=2)
    language = _detect_language(code_snippet)
    return (
        f"You are a contract validator. Analyze the following code snippet for the "
        f"endpoint `{endpoint}` and identify any fields that are"
        f" missing, have the wrong "
        f"type, or otherwise violate the OpenAPI schema below.\n\n"
        f"**OpenAPI schema for {endpoint}:**\n```json\n{schema_json}\n```\n\n"
        f"**Code snippet:**\n```{language}\n{code_snippet}\n```\n\n"
        f"Use the `report_violations` tool to report every drift you find. "
        f"Report an empty violations list if the code conforms to the schema."
    )


REPORT_VIOLATIONS_TOOL: ToolParam = {
    "name": "report_violations",
    "description": (
        "Report contract violations found between the code and the OpenAPI schema."
    ),
    "input_schema": {
        "type": "object",
        "required": ["violations"],
        "properties": {
            "violations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["field", "expected", "found", "explanation"],
                    "properties": {
                        "field": {
                            "type": "string",
                            "description": "The field name that has a violation.",
                        },
                        "expected": {
                            "type": "string",
                            "description": (
                                "What the schema expects (e.g. 'present', 'integer')."
                            ),
                        },
                        "found": {
                            "type": "string",
                            "description": "What the code actually provides.",
                        },
                        "explanation": {
                            "type": "string",
                            "description": (
                                "Human-readable explanation of the violation."
                            ),
                        },
                    },
                },
            }
        },
    },
}
