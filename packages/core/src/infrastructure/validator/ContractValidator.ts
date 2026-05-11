import type { FunctionShape } from "../../domain/FunctionShape.js";
import type { IValidator } from "../../domain/IValidator.js";
import type { Violation } from "../../domain/Violation.js";

export class ContractValidator implements IValidator {
  validate(
    shape: FunctionShape,
    schema: Record<string, unknown>,
    file: string,
  ): Violation[] {
    if (shape.returnShape === null || shape.isDynamic) return [];

    const required = Array.isArray(schema.required)
      ? [
          ...new Set(
            schema.required.filter((f): f is string => typeof f === "string"),
          ),
        ]
      : [];
    const violations: Violation[] = [];

    for (const field of required) {
      if (!Object.hasOwn(shape.returnShape, field)) {
        violations.push({
          file,
          line: shape.line,
          endpoint: shape.endpointGuess ?? "unknown",
          field,
          expected: "present",
          found: "missing",
          severity: "error",
          suppressed: shape.suppressed,
        });
      }
    }

    return violations;
  }
}
