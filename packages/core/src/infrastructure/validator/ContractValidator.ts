import type { FieldShape, FunctionShape } from "../../domain/FunctionShape.js";
import type { IValidator } from "../../domain/IValidator.js";
import type { Violation } from "../../domain/Violation.js";

const NUMERIC_TYPES = new Set(["integer", "number"]);

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
    shapeFields: Record<string, FieldShape>,
    shape: FunctionShape,
    schema: Record<string, unknown>,
    file: string,
    fieldPrefix = "",
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
      const fullField = fieldPrefix + field;
      if (!Object.hasOwn(shapeFields, field)) {
        violations.push({
          file,
          line: shape.line,
          endpoint: shape.endpointGuess ?? "unknown",
          field: fullField,
          expected: "present",
          found: "missing",
          severity: "error",
          suppressed: shape.suppressed,
        });
      } else {
        const inferredValue = shapeFields[field];
        if (typeof inferredValue === "object" && inferredValue !== null) {
          const nestedSchema = this.fieldSchemaFor(schema, field);
          if (nestedSchema !== null) {
            const schemaType = this.typeFromSchema(nestedSchema);
            if (schemaType !== null && schemaType !== "object") {
              violations.push({
                file,
                line: shape.line,
                endpoint: shape.endpointGuess ?? "unknown",
                field: fullField,
                expected: schemaType,
                found: "object",
                severity: "warn",
                suppressed: shape.suppressed,
              });
            } else {
              violations.push(
                ...this.checkFields(
                  inferredValue,
                  shape,
                  nestedSchema,
                  file,
                  `${fullField}.`,
                ),
              );
            }
          }
        } else {
          const specType = this.specTypeFor(schema, field);
          if (
            inferredValue !== null &&
            specType !== null &&
            !this.typesCompatible(inferredValue, specType)
          ) {
            violations.push({
              file,
              line: shape.line,
              endpoint: shape.endpointGuess ?? "unknown",
              field: fullField,
              expected: specType,
              found: inferredValue,
              severity: "warn",
              suppressed: shape.suppressed,
            });
          }
        }
      }
    }

    return violations;
  }

  private fieldSchemaFor(
    schema: Record<string, unknown>,
    field: string,
  ): Record<string, unknown> | null {
    const { properties } = schema;
    if (typeof properties !== "object" || properties === null) return null;
    const fieldSchema = (properties as Record<string, unknown>)[field];
    if (typeof fieldSchema !== "object" || fieldSchema === null) return null;
    return fieldSchema as Record<string, unknown>;
  }

  private specTypeFor(
    schema: Record<string, unknown>,
    field: string,
  ): string | null {
    const fieldSchema = this.fieldSchemaFor(schema, field);
    return fieldSchema !== null ? this.typeFromSchema(fieldSchema) : null;
  }

  private typeFromSchema(schema: Record<string, unknown>): string | null {
    const { type } = schema;
    if (typeof type === "string") return type;
    // OpenAPI 3.1 allows `type: ["string", "null"]` for nullable fields — use first non-null entry
    if (Array.isArray(type)) {
      return (
        type.find((t): t is string => typeof t === "string" && t !== "null") ??
        null
      );
    }
    return null;
  }

  private typesCompatible(inferred: string, spec: string): boolean {
    if (inferred === spec) return true;
    return NUMERIC_TYPES.has(inferred) && NUMERIC_TYPES.has(spec);
  }
}
