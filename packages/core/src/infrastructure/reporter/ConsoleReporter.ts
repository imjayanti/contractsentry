import type { IReporter } from "../../domain/IReporter.js";
import type { Violation } from "../../domain/Violation.js";

export class ConsoleReporter implements IReporter {
  constructor(
    private readonly writeLine: (line: string) => void = console.log,
  ) {}

  report(violations: Violation[]): void {
    const actionable = violations.filter((violation) => !violation.suppressed);
    for (const violation of actionable) {
      this.writeLine(
        `${violation.file}:${violation.line}  ${violation.severity}  ${violation.endpoint}  field "${violation.field}" expected ${violation.expected}, found ${violation.found}`,
      );
      if (violation.explanation) {
        this.writeLine(`  → ${violation.explanation}`);
      }
    }
    if (actionable.length > 0) {
      this.writeLine("");
      this.writeLine(
        `Found ${actionable.length} ${actionable.length === 1 ? "violation" : "violations"}`,
      );
    }
  }
}
