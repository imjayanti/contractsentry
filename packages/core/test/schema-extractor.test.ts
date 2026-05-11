import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "../src/domain/ISpecLoader.js";
import { OpenApiSpecLoader } from "../src/infrastructure/spec/OpenApiSpecLoader.js";
import { SchemaExtractor } from "../src/infrastructure/spec/SchemaExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "simple.openapi.yaml");
const FIXTURE_EXT = join(__dirname, "fixtures", "extended.openapi.yaml");

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
