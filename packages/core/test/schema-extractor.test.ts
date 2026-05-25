import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "../src/domain/ISpecLoader.js";
import { OpenApiSpecLoader } from "../src/infrastructure/spec/OpenApiSpecLoader.js";
import { SchemaExtractor } from "../src/infrastructure/spec/SchemaExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "simple.openapi.yaml");
const FIXTURE_EXT = join(__dirname, "fixtures", "extended.openapi.yaml");

function makeDoc(
  path: string,
  method: "get" | "post" | "put",
  schema: Record<string, unknown>,
): OpenAPIDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      [path]: {
        [method]: {
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema } },
            },
          },
        },
      },
    },
  } as unknown as OpenAPIDocument;
}

describe("SchemaExtractor — simple fixture", () => {
  let schemas: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    const doc = await new OpenApiSpecLoader().load(FIXTURE);
    schemas = new SchemaExtractor().extract(doc);
  });

  it("extracts exactly 3 schemas", () => {
    // GET /users/{id}:200, POST /users:201, POST /users:request
    expect(schemas.size).toBe(3);
  });

  it("extracts GET /users/{id} response schema", () => {
    expect(schemas.has("GET /users/{id}:200")).toBe(true);
  });

  it("extracts POST /users response schema", () => {
    expect(schemas.has("POST /users:201")).toBe(true);
  });

  it("extracts POST /users request body schema", () => {
    expect(schemas.has("POST /users:request")).toBe(true);
  });

  it("GET endpoint does not produce a request schema", () => {
    expect(schemas.has("GET /users/{id}:request")).toBe(false);
  });

  it("preserves required fields in response schema", () => {
    const schema = schemas.get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id", "name", "email"]);
  });

  it("preserves required fields in request schema", () => {
    const schema = schemas.get("POST /users:request");
    expect(schema?.required).toEqual(["name", "email"]);
  });

  it("preserves property types in response schema", () => {
    const schema = schemas.get("GET /users/{id}:200");
    const props = schema?.properties as Record<
      string,
      { type: string; format?: string }
    >;
    expect(props.id.type).toBe("integer");
    expect(props.name.type).toBe("string");
    expect(props.email.type).toBe("string");
    expect(props.email.format).toBe("email");
  });

  it("resolves $ref — no $ref string remains in extracted schema", () => {
    const schema = schemas.get("GET /users/{id}:200");
    expect(schema?.properties).toBeDefined();
    expect(schema?.$ref).toBeUndefined();
  });
});

describe("SchemaExtractor — extended fixture", () => {
  let schemas: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    const doc = await new OpenApiSpecLoader().load(FIXTURE_EXT);
    schemas = new SchemaExtractor().extract(doc);
  });

  it("extracts multiple response codes for the same endpoint", () => {
    expect(schemas.has("GET /users/{id}:200")).toBe(true);
    expect(schemas.has("GET /users/{id}:404")).toBe(true);
  });

  it("extracts PUT request body schema", () => {
    expect(schemas.has("PUT /users/{id}:request")).toBe(true);
  });

  it("extracts PUT response schema", () => {
    expect(schemas.has("PUT /users/{id}:200")).toBe(true);
  });

  it("does not extract DELETE 204 — no content body", () => {
    // 204 No Content has no application/json schema — must not appear
    expect(schemas.has("DELETE /users/{id}:204")).toBe(false);
  });

  it("no DELETE keys appear in the map", () => {
    const deleteKeys = [...schemas.keys()].filter((k) =>
      k.startsWith("DELETE"),
    );
    expect(deleteKeys).toHaveLength(0);
  });
});

describe("SchemaExtractor — array response schemas", () => {
  const extractor = new SchemaExtractor();

  it("unwraps array response — stores items schema under the status code key", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Array API", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "name"],
                        properties: {
                          id: { type: "integer" },
                          name: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    const schemas = extractor.extract(doc);
    const schema = schemas.get("GET /users:200");
    expect(schema).toBeDefined();
    expect(schema?.type).toBe("object");
    expect(schema?.required).toEqual(["id", "name"]);
  });

  it("skips array response when items is absent", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Array API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": { schema: { type: "array" } },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("GET /items:200")).toBe(false);
  });

  it("skips array response when items is a $ref (pre-dereference guard)", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Array API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Item" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("GET /items:200")).toBe(false);
  });

  it("skips array response when items is a primitive type", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Array API", version: "1.0.0" },
      paths: {
        "/tags": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("GET /tags:200")).toBe(false);
  });

  it("does not modify object response schema", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Object API", version: "1.0.0" },
      paths: {
        "/user": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["id"],
                      properties: { id: { type: "integer" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    const schema = extractor.extract(doc).get("GET /user:200");
    expect(schema?.type).toBe("object");
    expect(schema?.required).toEqual(["id"]);
  });
});

describe("SchemaExtractor — edge cases", () => {
  const extractor = new SchemaExtractor();

  it("returns empty map for a spec with no paths", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Empty", version: "1.0.0" },
      paths: {},
    } as OpenAPIDocument;
    expect(extractor.extract(doc).size).toBe(0);
  });

  it("skips responses with non-JSON content type", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "XML API", version: "1.0.0" },
      paths: {
        "/data": {
          get: {
            responses: {
              "200": {
                description: "XML response",
                content: { "application/xml": { schema: { type: "object" } } },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).size).toBe(0);
  });

  it("skips responses with no content field", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "No Content API", version: "1.0.0" },
      paths: {
        "/action": {
          post: {
            responses: {
              "204": { description: "No content" },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).size).toBe(0);
  });

  it("handles HEAD method", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "HEAD API", version: "1.0.0" },
      paths: {
        "/resource": {
          head: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { ok: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("HEAD /resource:200")).toBe(true);
  });

  it("skips request body with no application/json content", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Form API", version: "1.0.0" },
      paths: {
        "/upload": {
          post: {
            requestBody: {
              content: {
                "multipart/form-data": { schema: { type: "object" } },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("POST /upload:request")).toBe(false);
  });

  it("extracts 'default' status code response", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Default API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            responses: {
              default: {
                description: "Unexpected error",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { message: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    expect(extractor.extract(doc).has("GET /items:default")).toBe(true);
  });

  it("skips options and trace methods — not in HTTP_METHODS", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Options API", version: "1.0.0" },
      paths: {
        "/resource": {
          options: {
            responses: {
              "204": {
                description: "CORS preflight",
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
            },
          },
          trace: {
            responses: {
              "200": {
                description: "Trace",
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    const schemas = extractor.extract(doc);
    expect(schemas.has("OPTIONS /resource:204")).toBe(false);
    expect(schemas.has("TRACE /resource:200")).toBe(false);
  });

  it("extracts both JSON and non-JSON content types — only JSON schema is captured", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Multi-type API", version: "1.0.0" },
      paths: {
        "/data": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "integer" } },
                    },
                  },
                  "application/xml": { schema: { type: "object" } },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    const schemas = extractor.extract(doc);
    expect(schemas.has("GET /data:200")).toBe(true);
    expect(schemas.get("GET /data:200")).toMatchObject({
      properties: { id: { type: "integer" } },
    });
  });
});

describe("SchemaExtractor — allOf composition", () => {
  const extractor = new SchemaExtractor();

  it("merges required fields from all allOf subschemas", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            {
              type: "object",
              required: ["id"],
              properties: { id: { type: "integer" } },
            },
            {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
            },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(expect.arrayContaining(["id", "name"]));
    expect(schema?.required).toHaveLength(2);
  });

  it("merges properties from all allOf subschemas", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            { type: "object", properties: { id: { type: "integer" } } },
            { type: "object", properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.properties).toMatchObject({
      id: { type: "integer" },
      name: { type: "string" },
    });
  });

  it("merges base schema fields with allOf subschema fields", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer" } },
          allOf: [
            { required: ["name"], properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(expect.arrayContaining(["id", "name"]));
    expect(schema?.properties).toMatchObject({
      id: { type: "integer" },
      name: { type: "string" },
    });
  });

  it("handles allOf where a subschema has no required array", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            { type: "object", properties: { id: { type: "integer" } } },
            {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
            },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["name"]);
    expect(schema?.properties).toMatchObject({ id: { type: "integer" } });
  });

  it("resolves nested allOf (allOf inside allOf)", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            {
              allOf: [
                { required: ["id"], properties: { id: { type: "integer" } } },
                {
                  required: ["role"],
                  properties: { role: { type: "string" } },
                },
              ],
            },
            { required: ["name"], properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(
      expect.arrayContaining(["id", "role", "name"]),
    );
  });

  it("handles allOf with an empty subschema — contributes nothing", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            {},
            { required: ["id"], properties: { id: { type: "integer" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id"]);
    expect(schema?.properties).toMatchObject({ id: { type: "integer" } });
  });

  it("later subschema property overrides earlier for same key (last wins)", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          allOf: [
            { properties: { status: { type: "string" } } },
            { properties: { status: { type: "boolean" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    const props = schema?.properties as
      | Record<string, { type: string }>
      | undefined;
    expect(props?.status?.type).toBe("boolean");
  });

  it("resolves nested property schemas with allOf", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          type: "object",
          required: ["id", "address"],
          properties: {
            id: { type: "integer" },
            address: {
              allOf: [
                {
                  required: ["street"],
                  properties: { street: { type: "string" } },
                },
                {
                  required: ["city"],
                  properties: { city: { type: "string" } },
                },
              ],
            },
          },
        }),
      )
      .get("GET /users/{id}:200");
    const addressSchema = (schema?.properties as Record<string, unknown>)
      ?.address as Record<string, unknown> | undefined;
    expect(addressSchema?.required).toEqual(
      expect.arrayContaining(["street", "city"]),
    );
    expect(addressSchema?.properties).toMatchObject({
      street: { type: "string" },
      city: { type: "string" },
    });
  });

  it("preserves enum from a property-level allOf subschema", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              allOf: [{ type: "string" }, { enum: ["active", "inactive"] }],
            },
          },
        }),
      )
      .get("GET /users/{id}:200");
    const statusSchema = (schema?.properties as Record<string, unknown>)
      ?.status as Record<string, unknown> | undefined;
    expect(statusSchema?.type).toBe("string");
    expect(statusSchema?.enum).toEqual(["active", "inactive"]);
  });
});

describe("SchemaExtractor — oneOf composition", () => {
  const extractor = new SchemaExtractor();

  it("required = intersection — only fields required in ALL variants are flagged", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          oneOf: [
            {
              type: "object",
              required: ["id", "name"],
              properties: { id: { type: "integer" }, name: { type: "string" } },
            },
            {
              type: "object",
              required: ["id", "email"],
              properties: {
                id: { type: "integer" },
                email: { type: "string" },
              },
            },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id"]);
  });

  it("field required in only one variant is absent from merged required", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          oneOf: [
            { required: ["id"], properties: { id: { type: "integer" } } },
            { required: ["name"], properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    // id is required in variant 1 only, name in variant 2 only — intersection is empty
    expect(schema?.required ?? []).toHaveLength(0);
  });

  it("oneOf with no required in any variant produces empty required", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          oneOf: [
            { type: "object", properties: { id: { type: "integer" } } },
            { type: "object", properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required ?? []).toHaveLength(0);
    expect(schema?.type).toBe("object");
  });

  it("properties are the union of all variant properties", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          oneOf: [
            { properties: { id: { type: "integer" } } },
            { properties: { name: { type: "string" } } },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.properties).toMatchObject({
      id: { type: "integer" },
      name: { type: "string" },
    });
  });

  it("single-variant oneOf uses that variant directly", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          oneOf: [
            {
              type: "object",
              required: ["id"],
              properties: { id: { type: "integer" } },
            },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id"]);
    expect(schema?.type).toBe("object");
  });
});

describe("SchemaExtractor — anyOf / nullable", () => {
  const extractor = new SchemaExtractor();

  it("filters null variant — uses the remaining object schema", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          anyOf: [
            {
              type: "object",
              required: ["id", "name"],
              properties: { id: { type: "integer" }, name: { type: "string" } },
            },
            { type: "null" },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id", "name"]);
    expect(schema?.type).toBe("object");
  });

  it("multiple non-null anyOf variants → intersection of required", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          anyOf: [
            {
              required: ["id", "name"],
              properties: { id: { type: "integer" }, name: { type: "string" } },
            },
            {
              required: ["id", "email"],
              properties: {
                id: { type: "integer" },
                email: { type: "string" },
              },
            },
          ],
        }),
      )
      .get("GET /users/{id}:200");
    expect(schema?.required).toEqual(["id"]);
  });

  it("anyOf where all variants are null — stored as empty schema, produces no violations", () => {
    const schemas = extractor.extract(
      makeDoc("/items", "get", {
        anyOf: [{ type: "null" }, { type: "null" }],
      }),
    );
    // All variants filtered out → empty schema stored; validator finds no required → no violations
    const schema = schemas.get("GET /items:200");
    expect(schema?.required).toBeUndefined();
    expect(schema?.properties).toBeUndefined();
  });

  it("preserves enum from the non-null anyOf variant on a property", () => {
    const schema = extractor
      .extract(
        makeDoc("/users/{id}", "get", {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              anyOf: [
                { type: "string", enum: ["active", "inactive"] },
                { type: "null" },
              ],
            },
          },
        }),
      )
      .get("GET /users/{id}:200");
    const statusSchema = (schema?.properties as Record<string, unknown>)
      ?.status as Record<string, unknown> | undefined;
    expect(statusSchema?.type).toBe("string");
    expect(statusSchema?.enum).toEqual(["active", "inactive"]);
  });

  it("request body with anyOf nullable resolves to the non-null schema", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    anyOf: [
                      {
                        type: "object",
                        required: ["name"],
                        properties: { name: { type: "string" } },
                      },
                      { type: "null" },
                    ],
                  },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    } as unknown as OpenAPIDocument;
    const schema = new SchemaExtractor()
      .extract(doc)
      .get("POST /users:request");
    expect(schema?.required).toEqual(["name"]);
  });
});
