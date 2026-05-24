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
    return this.checkFields(shape.returnShape, shape, schema, file);
  }

  validateRequest(
    shape: FunctionShape,
    schema: Record<string, unknown>,
    file: string,
  ): Violation[] {
    if (shape.paramShape === null) return [];
    return this.checkFields(shape.paramShape, shape, schema, file);
  }

  private checkFields(
    shapeFields: Record<string, string | null>,
    shape: FunctionShape,
    schema: Record<string, unknown>,
    file: string,
  ): Violation[] {
    const required = Array.isArray(schema.required)
      ? [
          ...new Set(
            schema.required.filter((f): f is string => typeof f === "string"),
          ),
        ]
      : [];
    const violations: Violation[] = [];

    for (const field of required) {
      if (!Object.hasOwn(shapeFields, field)) {
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
      } else {
        const inferredType = shapeFields[field];
        const specType = this.specTypeFor(schema, field);
        if (
          inferredType !== null &&
          specType !== null &&
          !this.typesCompatible(inferredType, specType)
        ) {
          violations.push({
            file,
            line: shape.line,
            endpoint: shape.endpointGuess ?? "unknown",
            field,
            expected: specType,
            found: inferredType,
            severity: "warn",
            suppressed: shape.suppressed,
          });
        }
      }
    }

    return violations;
  }

  private specTypeFor(
    schema: Record<string, unknown>,
    field: string,
  ): string | null {
    const { properties } = schema;
    if (typeof properties !== "object" || properties === null) return null;
    const fieldSchema = (properties as Record<string, unknown>)[field];
    if (typeof fieldSchema !== "object" || fieldSchema === null) return null;
    const { type } = fieldSchema as Record<string, unknown>;
    if (typeof type === "string") return type;
    // OpenAPI 3.1 allows `type: ["string", "null"]` for nullable fields — use first non-null entry
    if (Array.isArray(type)) {
      const primary = type.find(
        (t): t is string => typeof t === "string" && t !== "null",
      );
      return primary ?? null;
    }
    return null;
  }

  private typesCompatible(inferred: string, spec: string): boolean {
    if (inferred === spec) return true;
    // integer is a valid number — treat numeric types as interchangeable
    const numeric = new Set(["integer", "number"]);
    return numeric.has(inferred) && numeric.has(spec);
  }
}
