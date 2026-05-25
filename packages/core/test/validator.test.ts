import { describe, expect, it } from "vitest";
import type { FunctionShape } from "../src/domain/FunctionShape.js";
import { ContractValidator } from "../src/infrastructure/validator/ContractValidator.js";

const validator = new ContractValidator();

function shape(overrides: Partial<FunctionShape> = {}): FunctionShape {
  return {
    name: "getUser",
    endpointGuess: "GET /users/{id}",
    statusHint: null,
    returnShape: { id: null, name: null, email: null },
    paramShape: null,
    line: 5,
    suppressed: false,
    isDynamic: false,
    ...overrides,
  };
}

const schema = {
  type: "object",
  required: ["id", "name", "email"],
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
  },
};

describe("ContractValidator — no violations", () => {
  it("returns empty array when all required fields are present", () => {
    expect(validator.validate(shape(), schema, "src/routes/users.ts")).toEqual(
      [],
    );
  });

  it("returns empty array when schema has no required array", () => {
    const noRequired = {
      type: "object",
      properties: { id: { type: "integer" } },
    };
    expect(
      validator.validate(
        shape({ returnShape: {} }),
        noRequired,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("returns empty array when required is empty", () => {
    const emptyRequired = { type: "object", required: [], properties: {} };
    expect(
      validator.validate(
        shape({ returnShape: {} }),
        emptyRequired,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("returns empty array when returnShape is null (dynamic return)", () => {
    expect(
      validator.validate(
        shape({ returnShape: null }),
        schema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("does not emit violations for extra fields not in spec", () => {
    const extra = { ...shape().returnShape, extra: null };
    expect(
      validator.validate(
        shape({ returnShape: extra }),
        schema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });
});

describe("ContractValidator — missing required fields", () => {
  it("emits one violation for a single missing field", () => {
    const violations = validator.validate(
      shape({ returnShape: { id: null, name: null } }),
      schema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("email");
  });

  it("emits violations for all missing fields", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      schema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(3);
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("id");
    expect(fields).toContain("name");
    expect(fields).toContain("email");
  });

  it("populates violation fields correctly", () => {
    const violations = validator.validate(
      shape({ returnShape: { id: null, name: null }, line: 12 }),
      schema,
      "src/routes/users.ts",
    );
    expect(violations[0]).toMatchObject({
      file: "src/routes/users.ts",
      line: 12,
      endpoint: "GET /users/{id}",
      field: "email",
      expected: "present",
      found: "missing",
      severity: "error",
      suppressed: false,
    });
  });

  it("uses endpointGuess as endpoint in violation", () => {
    const violations = validator.validate(
      shape({ returnShape: {}, endpointGuess: "POST /items" }),
      schema,
      "src/routes/items.ts",
    );
    for (const v of violations) {
      expect(v.endpoint).toBe("POST /items");
    }
  });

  it("uses 'unknown' as endpoint when endpointGuess is null", () => {
    const violations = validator.validate(
      shape({ returnShape: {}, endpointGuess: null }),
      schema,
      "src/routes/users.ts",
    );
    for (const v of violations) {
      expect(v.endpoint).toBe("unknown");
    }
  });
});

describe("ContractValidator — suppression", () => {
  it("marks violations suppressed when shape is suppressed", () => {
    const violations = validator.validate(
      shape({ returnShape: {}, suppressed: true }),
      schema,
      "src/routes/users.ts",
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.suppressed).toBe(true);
    }
  });

  it("marks violations not suppressed when shape is not suppressed", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      schema,
      "src/routes/users.ts",
    );
    for (const v of violations) {
      expect(v.suppressed).toBe(false);
    }
  });
});

describe("ContractValidator — isDynamic", () => {
  it("returns empty array when isDynamic is true, even with missing fields", () => {
    expect(
      validator.validate(
        shape({ returnShape: {}, isDynamic: true }),
        schema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("returns empty array when both isDynamic and returnShape is null", () => {
    expect(
      validator.validate(
        shape({ returnShape: null, isDynamic: true }),
        schema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });
});

describe("ContractValidator — malformed schema.required", () => {
  it("treats non-array required as no required fields", () => {
    expect(
      validator.validate(
        shape({ returnShape: {} }),
        { required: true },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("treats string required as no required fields", () => {
    expect(
      validator.validate(
        shape({ returnShape: {} }),
        { required: "id" },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("skips non-string entries in required array", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      { required: [1, null, "email"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("email");
  });

  it("deduplicates repeated required fields — emits at most one violation per field", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      { required: ["email", "email", "id", "id"] },
      "src/routes/users.ts",
    );
    const fields = violations.map((v) => v.field);
    expect(fields).toEqual(["email", "id"]);
  });
});

describe("ContractValidator — validateRequest", () => {
  const requestSchema = {
    type: "object",
    required: ["name", "email"],
    properties: {
      name: { type: "string" },
      email: { type: "string" },
    },
  };

  it("returns empty array when all required params are present", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: { name: null, email: null } }),
        requestSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("returns empty array when paramShape is null", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: null }),
        requestSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits error for a missing required param", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: { name: null } }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("email");
    expect(violations[0]?.severity).toBe("error");
  });

  it("emits errors for all missing required params", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {} }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(2);
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("name");
    expect(fields).toContain("email");
  });

  it("populates violation fields correctly", () => {
    const violations = validator.validateRequest(
      shape({
        paramShape: { name: null },
        line: 16,
        endpointGuess: "POST /users",
      }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations[0]).toMatchObject({
      file: "src/routes/users.ts",
      line: 16,
      endpoint: "POST /users",
      field: "email",
      expected: "present",
      found: "missing",
      severity: "error",
      suppressed: false,
    });
  });

  it("ignores isDynamic — validates params regardless", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {}, isDynamic: true }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(2);
  });

  it("marks request violations suppressed when shape is suppressed", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {}, suppressed: true }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.suppressed).toBe(true);
    }
  });

  it("deduplicates repeated required fields", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {} }),
      { required: ["name", "name", "email"] },
      "src/routes/users.ts",
    );
    expect(violations.map((v) => v.field)).toEqual(["name", "email"]);
  });

  it("uses 'unknown' as endpoint when endpointGuess is null", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {}, endpointGuess: null }),
      requestSchema,
      "src/routes/users.ts",
    );
    for (const v of violations) {
      expect(v.endpoint).toBe("unknown");
    }
  });
});

describe("ContractValidator — type validation", () => {
  const typedSchema = {
    type: "object",
    required: ["id", "name", "active"],
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      active: { type: "boolean" },
    },
  };

  it("emits warn for type mismatch — spec integer, found string", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "string", name: "string", active: "boolean" },
      }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "id",
      expected: "integer",
      found: "string",
      severity: "warn",
    });
  });

  it("emits no violation when all types match", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "integer", name: "string", active: "boolean" },
      }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toEqual([]);
  });

  it("emits no type violation when inferred type is null (unknown)", () => {
    const violations = validator.validate(
      shape({ returnShape: { id: null, name: null, active: null } }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toEqual([]);
  });

  it("emits no type violation when spec has no properties", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "string", name: "string", active: "string" },
      }),
      { required: ["id", "name", "active"] },
      "src/routes/users.ts",
    );
    expect(violations).toEqual([]);
  });

  it("treats integer as compatible with number", () => {
    expect(
      validator.validate(
        shape({
          returnShape: { id: "integer", name: "string", active: "boolean" },
        }),
        {
          required: ["id", "name", "active"],
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            active: { type: "boolean" },
          },
        },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("treats number as compatible with integer", () => {
    expect(
      validator.validate(
        shape({
          returnShape: { id: "number", name: "string", active: "boolean" },
        }),
        typedSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("suppresses type violations when shape is suppressed", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "string", name: "string", active: "boolean" },
        suppressed: true,
      }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.suppressed).toBe(true);
    }
  });

  it("type violation uses warn severity", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "string", name: "string", active: "boolean" },
      }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations[0]?.severity).toBe("warn");
  });

  it("emits warn for spec string, inferred boolean (clear incompatible types)", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "integer", name: "boolean", active: "boolean" },
      }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "name",
      expected: "string",
      found: "boolean",
      severity: "warn",
    });
  });

  it("emits both a missing-field error and a type-mismatch warn in the same call", () => {
    // id is present but wrong type; active is missing entirely
    const violations = validator.validate(
      shape({ returnShape: { id: "string", name: "string" } }),
      typedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(2);
    expect(
      violations.some((v) => v.field === "id" && v.severity === "warn"),
    ).toBe(true);
    expect(
      violations.some((v) => v.field === "active" && v.severity === "error"),
    ).toBe(true);
  });

  it("uses first non-null entry when spec type is an OpenAPI nullable array", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "integer", name: "boolean", active: "boolean" },
      }),
      {
        required: ["id", "name", "active"],
        properties: {
          id: { type: "integer" },
          name: { type: ["string", "null"] },
          active: { type: "boolean" },
        },
      },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "name",
      expected: "string",
      found: "boolean",
    });
  });
});

describe("ContractValidator — validateRequest type validation", () => {
  const requestSchema = {
    type: "object",
    required: ["id", "active"],
    properties: {
      id: { type: "integer" },
      active: { type: "boolean" },
    },
  };

  it("emits warn when request param type mismatches spec", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: { id: "string", active: "boolean" } }),
      requestSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "id",
      expected: "integer",
      found: "string",
      severity: "warn",
    });
  });

  it("emits no violation when request param types match spec", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: { id: "integer", active: "boolean" } }),
        requestSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits no type violation when param type is null (unknown)", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: { id: null, active: null } }),
        requestSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });
});

describe("ContractValidator — validateRequest malformed schema.required", () => {
  it("treats non-array required as no required params", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: {} }),
        { required: true },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("treats string required as no required params", () => {
    expect(
      validator.validateRequest(
        shape({ paramShape: {} }),
        { required: "name" },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("skips non-string entries in required array", () => {
    const violations = validator.validateRequest(
      shape({ paramShape: {} }),
      { required: [1, null, "email"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("email");
  });
});

describe("ContractValidator — nested object validation", () => {
  const nestedSchema = {
    type: "object",
    required: ["id", "address"],
    properties: {
      id: { type: "integer" },
      address: {
        type: "object",
        required: ["city", "zip"],
        properties: {
          city: { type: "string" },
          zip: { type: "string" },
        },
      },
    },
  };

  it("emits no violation when all nested required fields are present", () => {
    expect(
      validator.validate(
        shape({
          returnShape: {
            id: "integer",
            address: { city: "string", zip: "string" },
          },
        }),
        nestedSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits error with dot-notation field name for missing nested required field", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "integer", address: { city: "string" } },
      }),
      nestedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "address.zip",
      expected: "present",
      found: "missing",
      severity: "error",
    });
  });

  it("emits warn with dot-notation field name for nested type mismatch", () => {
    const violations = validator.validate(
      shape({
        returnShape: {
          id: "integer",
          address: { city: "integer", zip: "string" },
        },
      }),
      nestedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "address.city",
      expected: "string",
      found: "integer",
      severity: "warn",
    });
  });

  it("emits violations for all missing nested required fields when nested object is empty", () => {
    const violations = validator.validate(
      shape({ returnShape: { id: "integer", address: {} } }),
      nestedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(2);
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("address.city");
    expect(fields).toContain("address.zip");
  });

  it("skips nested validation when nested schema has no required or properties", () => {
    expect(
      validator.validate(
        shape({ returnShape: { id: "integer", address: { city: "string" } } }),
        {
          type: "object",
          required: ["id", "address"],
          properties: { id: { type: "integer" }, address: { type: "object" } },
        },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("validates deeply nested fields with multi-segment dot-notation", () => {
    const deepSchema = {
      type: "object",
      required: ["meta"],
      properties: {
        meta: {
          type: "object",
          required: ["geo"],
          properties: {
            geo: {
              type: "object",
              required: ["lat"],
              properties: { lat: { type: "number" } },
            },
          },
        },
      },
    };
    const violations = validator.validate(
      shape({ returnShape: { meta: { geo: {} } } }),
      deepSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "meta.geo.lat",
      severity: "error",
    });
  });

  it("top-level missing field still emits flat field name", () => {
    const violations = validator.validate(
      shape({ returnShape: { id: "integer" } }),
      nestedSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "address",
      severity: "error",
    });
  });

  it("emits warn when shape returns a nested object but spec declares a scalar type", () => {
    const violations = validator.validate(
      shape({
        returnShape: { id: "integer", address: { city: "string" } },
      }),
      {
        type: "object",
        required: ["id", "address"],
        properties: {
          id: { type: "integer" },
          address: { type: "string" },
        },
      },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "address",
      expected: "string",
      found: "object",
      severity: "warn",
    });
  });
});

describe("ContractValidator — prototype-shadowing fields", () => {
  it("emits violation when required field shadows Object.prototype (e.g. hasOwnProperty)", () => {
    // 'hasOwnProperty' exists on Object.prototype; `in` would give a false negative
    const violations = validator.validate(
      shape({ returnShape: {} }),
      { required: ["hasOwnProperty"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("hasOwnProperty");
  });

  it("does not emit violation when prototype-named field is explicitly present in returnShape", () => {
    const violations = validator.validate(
      shape({ returnShape: { hasOwnProperty: null } }),
      { required: ["hasOwnProperty"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(0);
  });

  it("emits violation for 'constructor' — also a prototype-shadowing field", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      { required: ["constructor"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("constructor");
  });

  it("emits violation for 'toString' — also a prototype-shadowing field", () => {
    const violations = validator.validate(
      shape({ returnShape: {} }),
      { required: ["toString"] },
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("toString");
  });
});

describe("ContractValidator — enum validation", () => {
  const enumSchema = {
    type: "object",
    required: ["status", "role"],
    properties: {
      status: { type: "string", enum: ["active", "inactive", "pending"] },
      role: { type: "string", enum: ["admin", "user", "guest"] },
    },
  };

  it("emits no violation when string literal is in the enum", () => {
    expect(
      validator.validate(
        shape({ returnShape: { status: '"active"', role: '"admin"' } }),
        enumSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits warn when string literal is not in the enum", () => {
    const violations = validator.validate(
      shape({ returnShape: { status: '"draft"', role: '"admin"' } }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "status",
      expected: "one of [active, inactive, pending]",
      found: "draft",
      severity: "warn",
    });
  });

  it("emits no enum violation when inferred value is null (unknown)", () => {
    expect(
      validator.validate(
        shape({ returnShape: { status: null, role: null } }),
        enumSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits no enum violation when spec field has no enum array", () => {
    expect(
      validator.validate(
        shape({ returnShape: { status: '"active"', role: '"admin"' } }),
        {
          type: "object",
          required: ["status", "role"],
          properties: {
            status: { type: "string" },
            role: { type: "string" },
          },
        },
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("type mismatch takes precedence — no enum violation when value type is incompatible", () => {
    const violations = validator.validate(
      shape({ returnShape: { status: "integer", role: '"admin"' } }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "status",
      expected: "string",
      found: "integer",
      severity: "warn",
    });
  });

  it("emits warn for single-quoted string literal not in enum", () => {
    const violations = validator.validate(
      shape({ returnShape: { status: "'draft'", role: '"admin"' } }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "status",
      found: "draft",
      severity: "warn",
    });
  });

  it("emits violations for all fields whose literals are not in their enum", () => {
    const violations = validator.validate(
      shape({ returnShape: { status: '"unknown"', role: '"superuser"' } }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(2);
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("status");
    expect(fields).toContain("role");
  });

  it("suppresses enum violations when shape is suppressed", () => {
    const violations = validator.validate(
      shape({
        returnShape: { status: '"draft"', role: '"admin"' },
        suppressed: true,
      }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.suppressed).toBe(true);
    }
  });

  it("emits no enum violation when value is a type-name string (not a literal)", () => {
    // "string" used as a type name directly (not from source literal) — no enum check applies
    expect(
      validator.validate(
        shape({ returnShape: { status: "string", role: "string" } }),
        enumSchema,
        "src/routes/users.ts",
      ),
    ).toEqual([]);
  });

  it("emits warn for empty string literal not in enum", () => {
    const violations = validator.validate(
      shape({ returnShape: { status: '""', role: '"admin"' } }),
      enumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "status",
      found: "",
      severity: "warn",
    });
  });

  it("emits warn with dot-notation field name for enum violation in nested field", () => {
    const nestedEnumSchema = {
      type: "object",
      required: ["order"],
      properties: {
        order: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["pending", "shipped"] },
          },
        },
      },
    };
    const violations = validator.validate(
      shape({ returnShape: { order: { status: '"cancelled"' } } }),
      nestedEnumSchema,
      "src/routes/users.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "order.status",
      expected: "one of [pending, shipped]",
      found: "cancelled",
      severity: "warn",
    });
  });
});
