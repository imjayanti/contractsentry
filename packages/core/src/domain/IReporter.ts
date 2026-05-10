import type { Violation } from "./Violation.js";

export interface IReporter {
  report(violations: Violation[]): void;
}
