import type { FunctionShape } from "./FunctionShape.js";
import type { Violation } from "./Violation.js";

export interface IValidator {
  validate(shape: FunctionShape, schema: Record<string, unknown>): Violation[];
}
