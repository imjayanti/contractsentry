import type { FieldShape, FunctionShape } from "../../domain/FunctionShape.js";
import type { IValidator } from "../../domain/IValidator.js";
import type { Severity, Violation } from "../../domain/Violation.js";

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
        violations.push(
          this.buildViolation(
            shape,
            file,
            fullField,
            "error",
            "present",
            "missing",
          ),
        );
        continue;
      }

      const inferredValue = shapeFields[field];
      if (typeof inferredValue === "object" && inferredValue !== null) {
        const nestedSchema = this.fieldSchemaFor(schema, field);
        if (nestedSchema !== null) {
          const schemaType = this.typeFromSchema(nestedSchema);
          if (schemaType !== null && schemaType !== "object") {
            violations.push(
              this.buildViolation(
                shape,
                file,
                fullField,
                "warn",
                schemaType,
                "object",
              ),
            );
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
        const fieldSchema = this.fieldSchemaFor(schema, field);
        const specType =
          fieldSchema !== null ? this.typeFromSchema(fieldSchema) : null;
        const hasTypeMismatch =
          inferredValue !== null &&
          specType !== null &&
          !this.typesCompatible(inferredValue, specType);

        if (hasTypeMismatch) {
          violations.push(
            this.buildViolation(
              shape,
              file,
              fullField,
              "warn",
              specType,
              inferredValue,
            ),
          );
        } else if (
          inferredValue !== null &&
          this.isStringLiteral(inferredValue)
        ) {
          const enumValues =
            fieldSchema !== null
              ? this.enumValuesFromSchema(fieldSchema)
              : null;
          if (
            enumValues !== null &&
            !enumValues.includes(this.stripQuotes(inferredValue))
          ) {
            violations.push(
              this.buildViolation(
                shape,
                file,
                fullField,
                "warn",
                `one of [${enumValues.join(", ")}]`,
                this.stripQuotes(inferredValue),
              ),
            );
          }
        }
      }
    }

    return violations;
  }

  private buildViolation(
    shape: FunctionShape,
    file: string,
    field: string,
    severity: Severity,
    expected: string,
    found: string,
  ): Violation {
    return {
      file,
      line: shape.line,
      endpoint: shape.endpointGuess ?? "unknown",
      field,
      expected,
      found,
      severity,
      suppressed: shape.suppressed,
    };
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
    if (this.isStringLiteral(inferred)) return spec === "string";
    if (inferred === spec) return true;
    return NUMERIC_TYPES.has(inferred) && NUMERIC_TYPES.has(spec);
  }

  private isStringLiteral(value: string): boolean {
    return (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    );
  }

  private stripQuotes(value: string): string {
    return value.slice(1, -1);
  }

  private enumValuesFromSchema(
    schema: Record<string, unknown>,
  ): string[] | null {
    const { enum: enumArr } = schema;
    if (!Array.isArray(enumArr)) return null;
    const values = enumArr.filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : null;
  }
}
