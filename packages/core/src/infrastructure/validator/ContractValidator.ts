import type {
  FieldShape,
  FieldShapeRecord,
  FunctionShape,
} from "../../domain/FunctionShape.js";
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
    shapeFields: FieldShapeRecord,
    shape: FunctionShape,
    schema: Record<string, unknown>,
    file: string,
    fieldPrefix = "",
  ): Violation[] {
    const required = Array.isArray(schema.required)
      ? [
          ...new Set(
            schema.required.filter(
              (item): item is string => typeof item === "string",
            ),
          ),
        ]
      : [];
    const violations: Violation[] = [];

    const requiredSet = new Set(required);

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

      violations.push(
        ...this.checkFieldValue(
          field,
          fullField,
          shapeFields[field],
          schema,
          shape,
          file,
        ),
      );
    }

    // Type-check optional fields that appear in the return shape and have a
    // spec definition — they're not required, so no "missing" error, but a
    // wrong type is still a contract violation.
    for (const field of Object.keys(shapeFields)) {
      if (requiredSet.has(field)) continue;
      const fieldSchema = this.fieldSchemaFor(schema, field);
      if (fieldSchema === null) continue;
      const fullField = fieldPrefix + field;
      violations.push(
        ...this.checkFieldValue(
          field,
          fullField,
          shapeFields[field],
          schema,
          shape,
          file,
        ),
      );
    }

    return violations;
  }

  private checkFieldValue(
    field: string,
    fullField: string,
    inferredValue: FieldShape,
    schema: Record<string, unknown>,
    shape: FunctionShape,
    file: string,
  ): Violation[] {
    const violations: Violation[] = [];
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
      if (
        inferredValue !== null &&
        specType !== null &&
        !this.typesCompatible(inferredValue, specType)
      ) {
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
          fieldSchema !== null ? this.enumValuesFromSchema(fieldSchema) : null;
        if (enumValues !== null) {
          const literal = this.stripQuotes(inferredValue);
          if (!enumValues.includes(literal)) {
            violations.push(
              this.buildViolation(
                shape,
                file,
                fullField,
                "warn",
                `one of [${enumValues.join(", ")}]`,
                literal,
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
        type.find(
          (typeEntry): typeEntry is string =>
            typeof typeEntry === "string" && typeEntry !== "null",
        ) ?? null
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
    const values = enumArr.filter(
      (enumEntry): enumEntry is string => typeof enumEntry === "string",
    );
    return values.length > 0 ? values : null;
  }
}
