import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpecLoadError } from "../src/domain/errors.js";
import { OpenApiSpecLoader } from "../src/infrastructure/spec/OpenApiSpecLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_30 = join(__dirname, "fixtures", "simple.openapi.yaml");
const FIXTURE_SWAGGER2 = join(__dirname, "fixtures", "swagger2.yaml");

describe("OpenApiSpecLoader", () => {
  let loader: OpenApiSpecLoader;
  let dir: string;

  beforeEach(async () => {
    loader = new OpenApiSpecLoader();
    dir = await mkdtemp(join(tmpdir(), "csentry-spec-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("loads a valid YAML spec", async () => {
    const doc = await loader.load(FIXTURE_30);
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("Simple API");
  });

  it("loads a valid JSON spec", async () => {
    const jsonPath = join(dir, "openapi.json");
    await writeFile(
      jsonPath,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "JSON API", version: "1.0.0" },
        paths: {},
      }),
    );
    const doc = await loader.load(jsonPath);
    expect(doc.info.title).toBe("JSON API");
  });

  it("loads an OpenAPI 3.1 spec", async () => {
    const path31 = join(dir, "openapi31.json");
    await writeFile(
      path31,
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "3.1 API", version: "1.0.0" },
        paths: {},
      }),
    );
    const doc = await loader.load(path31);
    expect(doc.openapi).toBe("3.1.0");
  });

  it("resolves $ref schemas inline — no $ref strings remain", async () => {
    const doc = await loader.load(FIXTURE_30);
    expect(doc.paths["/users/{id}"]?.get?.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: expect.any(Object),
          },
        },
      },
    });
    const response = doc.paths["/users/{id}"]?.get?.responses["200"] as Record<
      string,
      unknown
    >;
    const content = response?.content as Record<
      string,
      { schema: Record<string, unknown> }
    >;
    expect(content?.["application/json"]?.schema?.$ref).toBeUndefined();
  });

  it("loads a spec with no paths", async () => {
    const emptyPath = join(dir, "empty.json");
    await writeFile(
      emptyPath,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Empty API", version: "1.0.0" },
        paths: {},
      }),
    );
    const doc = await loader.load(emptyPath);
    expect(doc.paths).toEqual({});
  });

  it("throws SpecLoadError for a missing file", async () => {
    await expect(loader.load("/non/existent/path.yaml")).rejects.toThrow(
      SpecLoadError,
    );
  });

  it("throws SpecLoadError for an invalid spec", async () => {
    const badPath = join(dir, "bad.yaml");
    await writeFile(badPath, "not: valid: openapi: at: all");
    await expect(loader.load(badPath)).rejects.toThrow(SpecLoadError);
  });

  it("throws SpecLoadError for a Swagger 2.x spec", async () => {
    await expect(loader.load(FIXTURE_SWAGGER2)).rejects.toThrow(SpecLoadError);
  });
});
