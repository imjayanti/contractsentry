"""Entry point: reads JSON from stdin, writes JSON violations to stdout."""

from __future__ import annotations

import sys

import msgspec
import typer

from contractsentry_ai.analyzer import AnalysisResult, analyze

app = typer.Typer(add_completion=False)


@app.command()
def main() -> None:
    """Read a JSON payload from stdin and write violations JSON to stdout."""
    try:
        raw = sys.stdin.buffer.read()
        payload: dict = msgspec.json.decode(raw)
        result: AnalysisResult = analyze(payload)
        sys.stdout.buffer.write(msgspec.json.encode(result))
    except Exception as exc:  # noqa: BLE001
        typer.echo(f"contractsentry-ai error: {exc}", err=True)
        raise typer.Exit(code=2) from exc


if __name__ == "__main__":
    app()
