import type { IReporter } from "../../domain/IReporter.js";
import type { Violation } from "../../domain/Violation.js";

export class ConsoleReporter implements IReporter {
  constructor(
    private readonly writeLine: (line: string) => void = console.log,
  ) {}

  report(violations: Violation[]): void {
    const actionable = violations.filter((v) => !v.suppressed);
    for (const v of actionable) {
      this.writeLine(
        `${v.file}:${v.line}  ${v.severity}  ${v.endpoint}  field "${v.field}" expected ${v.expected}, found ${v.found}`,
      );
    }
    if (actionable.length > 0) {
      this.writeLine("");
      this.writeLine(
        `Found ${actionable.length} ${actionable.length === 1 ? "violation" : "violations"}`,
      );
    }
  }
}
