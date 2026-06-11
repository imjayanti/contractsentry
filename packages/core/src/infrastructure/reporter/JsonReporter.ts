import type { IReporter } from "../../domain/IReporter.js";
import type { Violation } from "../../domain/Violation.js";

export class JsonReporter implements IReporter {
  constructor(
    private readonly write: (line: string) => void = (line) =>
      process.stdout.write(line),
  ) {}

  report(violations: Violation[]): void {
    const actionable = violations.filter((violation) => !violation.suppressed);
    this.write(JSON.stringify({ violations: actionable }));
  }
}
