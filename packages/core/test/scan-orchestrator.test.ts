import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnalysisError, SpecLoadError } from "../src/domain/Errors.js";
import { ScanOrchestrator } from "../src/infrastructure/scanner/ScanOrchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC = join(__dirname, "../../../examples/petstore/openapi.yaml");
const USERS_FIXTURE = join(
  __dirname,
  "../../../examples/petstore/routes/users.ts",
);

const orchestrator = new ScanOrchestrator();

describe("ScanOrchestrator — petstore integration", () => {
  let violations: Awaited<ReturnType<typeof orchestrator.scan>>;

  beforeAll(async () => {
    violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [USERS_FIXTURE],
    });
  });

  it("returns 3 violations for the petstore fixture", () => {
    expect(violations).toHaveLength(3);
  });

  it("detects missing email field on getUser", () => {
    const v = violations.find((v) => v.endpoint === "GET /users/{id}");
    expect(v).toMatchObject({
      file: USERS_FIXTURE,
      endpoint: "GET /users/{id}",
      field: "email",
      expected: "present",
      found: "missing",
      severity: "error",
      suppressed: false,
    });
  });

  it("detects missing email field on createUser", () => {
    const v = violations.find(
      (v) => v.endpoint === "POST /users" && v.field === "email",
    );
    expect(v).toMatchObject({
      endpoint: "POST /users",
      field: "email",
      severity: "error",
    });
  });

  it("detects id type drift on createUser — id is string but spec requires integer", () => {
    const v = violations.find(
      (v) => v.endpoint === "POST /users" && v.field === "id",
    );
    expect(v).toMatchObject({
      endpoint: "POST /users",
      field: "id",
      expected: "integer",
      found: "string",
      severity: "warn",
      suppressed: false,
    });
  });

  it("produces no violations for listUsers — returns all required fields in the items schema", () => {
    expect(violations.some((v) => v.endpoint === "GET /users")).toBe(false);
  });

  it("skips deleteUser — no @route annotation, endpointGuess is null", () => {
    expect(violations.some((v) => v.endpoint.includes("DELETE"))).toBe(false);
  });

  it("violations carry correct line numbers", () => {
    for (const v of violations) {
      expect(v.line).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("ScanOrchestrator — edge cases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-scan-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("returns empty violations for an empty filePaths array", async () => {
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [],
    });
    expect(violations).toHaveLength(0);
  });

  it("returns empty violations when no functions have @route annotations", async () => {
    const file = join(dir, "no-routes.ts");
    await writeFile(file, "export function helper() { return { id: 1 }; }");
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("returns empty violations when endpointGuess does not match any schema", async () => {
    const file = join(dir, "unknown-route.ts");
    await writeFile(
      file,
      "// @route GET /nonexistent\nexport function fn() { return {}; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("emits suppressed violations for a csentry-ignore function with a @route annotation", async () => {
    const file = join(dir, "suppressed.ts");
    await writeFile(
      file,
      [
        "// @route GET /users/{id}",
        "// csentry-ignore",
        "export function getUser(id: number) { return { id }; }",
      ].join("\n"),
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.suppressed).toBe(true);
    }
  });

  it("emits multiple violations when a function is missing several required fields", async () => {
    const file = join(dir, "multi-missing.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\nexport function getUser() { return {}; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const fields = violations.map((v) => v.field);
    expect(fields).toContain("id");
    expect(fields).toContain("name");
    expect(fields).toContain("email");
    expect(violations).toHaveLength(3);
  });

  it("scans multiple files concurrently and aggregates violations in file order", async () => {
    const fileA = join(dir, "a.ts");
    const fileB = join(dir, "b.ts");
    await writeFile(
      fileA,
      "// @route GET /users/{id}\nexport function getUser() { return { id: 1 }; }",
    );
    await writeFile(
      fileB,
      "// @route POST /users\nexport function createUser() { return { id: 1 }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [fileA, fileB],
    });
    const endpoints = violations.map((v) => v.endpoint);
    expect(endpoints).toContain("GET /users/{id}");
    expect(endpoints).toContain("POST /users");
    const aIndex = violations.findIndex((v) => v.file === fileA);
    const bIndex = violations.findIndex((v) => v.file === fileB);
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("propagates SpecLoadError for a missing spec file", async () => {
    await expect(
      orchestrator.scan({ specPath: "/no/such/spec.yaml", filePaths: [] }),
    ).rejects.toThrow(SpecLoadError);
  });

  it("propagates AnalysisError for a missing source file", async () => {
    await expect(
      orchestrator.scan({
        specPath: SPEC,
        filePaths: ["/no/such/file.ts"],
      }),
    ).rejects.toThrow(AnalysisError);
  });
});

describe("ScanOrchestrator — array response validation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-array-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("emits violations for missing fields in array response items", async () => {
    const file = join(dir, "missing-in-array.ts");
    await writeFile(
      file,
      // listUsers spec items require id + name + email; only id and name returned
      "// @route GET /users\nexport function listUsers() { return [{ id: 1, name: 'x' }]; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      endpoint: "GET /users",
      field: "email",
      severity: "error",
    });
  });

  it("emits no violation when array response items satisfy all required fields", async () => {
    const file = join(dir, "full-array.ts");
    await writeFile(
      file,
      "// @route GET /users\nexport function listUsers() { return [{ id: 1, name: 'x', email: 'a@b.com' }]; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("emits no violation when spec items are a primitive type — no field shapes to check", async () => {
    const spec = join(dir, "primitive-items.yaml");
    await writeFile(
      spec,
      [
        'openapi: "3.0.3"',
        'info: { title: "Tags API", version: "1.0.0" }',
        "paths:",
        "  /tags:",
        "    get:",
        "      responses:",
        '        "200":',
        '          description: "List of tags"',
        "          content:",
        "            application/json:",
        "              schema:",
        "                type: array",
        "                items:",
        "                  type: string",
      ].join("\n"),
    );
    const file = join(dir, "tags.ts");
    await writeFile(
      file,
      "// @route GET /tags\nexport function listTags() { return ['a', 'b']; }",
    );
    const violations = await orchestrator.scan({
      specPath: spec,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("detects type drift in array response items", async () => {
    const file = join(dir, "type-drift-array.ts");
    await writeFile(
      file,
      // id should be integer but returned as string
      "// @route GET /users\nexport function listUsers() { return [{ id: '1', name: 'x', email: 'a@b.com' }]; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      endpoint: "GET /users",
      field: "id",
      expected: "integer",
      found: "string",
      severity: "warn",
    });
  });
});

describe("ScanOrchestrator — dynamic return warnings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-dynamic-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("emits warn violation for annotated function with dynamic return", async () => {
    const file = join(dir, "dynamic.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\nexport function getUser(id: number) { return buildUser(id); }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const warn = violations.find((v) => v.severity === "warn");
    expect(warn).toMatchObject({
      endpoint: "GET /users/{id}",
      field: "(return value)",
      expected: "static object literal",
      found: "dynamic expression",
      severity: "warn",
      suppressed: false,
    });
  });

  it("does not emit warn when return is static", async () => {
    const file = join(dir, "static.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\nexport function getUser() { return { id: 1, name: 'x', email: 'a@b.com' }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations.some((v) => v.severity === "warn")).toBe(false);
  });

  it("does not emit warn for dynamic function without @route annotation", async () => {
    const file = join(dir, "no-route.ts");
    await writeFile(file, "export function helper() { return someVar; }");
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations.some((v) => v.severity === "warn")).toBe(false);
  });

  it("warn violation carries correct line number", async () => {
    const file = join(dir, "line.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\n// comment\nexport function getUser() { return someVar; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const warn = violations.find((v) => v.severity === "warn");
    expect(warn?.line).toBe(3);
  });

  it("warn violation is suppressed when function has csentry-ignore", async () => {
    const file = join(dir, "suppressed.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\n// csentry-ignore\nexport function getUser() { return someVar; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const warn = violations.find((v) => v.severity === "warn");
    expect(warn?.suppressed).toBe(true);
  });

  it("emits warn for dynamic return even when endpoint has no matching response schema", async () => {
    const file = join(dir, "unmatched-dynamic.ts");
    await writeFile(
      file,
      "// @route GET /nonexistent\nexport function f() { return buildData(); }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      severity: "warn",
      field: "(return value)",
      endpoint: "GET /nonexistent",
    });
  });
});

describe("ScanOrchestrator — status hint", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-status-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("validates against specific status code when annotation includes a hint", async () => {
    const file = join(dir, "status-hint.ts");
    await writeFile(
      file,
      "// @route POST /users 201\nexport function createUser(name: string, email: string) { return { id: 1, name, email }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("produces no violations when status hint matches no schema in spec", async () => {
    const file = join(dir, "wrong-status.ts");
    // POST /users only has a 201 schema in petstore — 200 does not exist
    await writeFile(
      file,
      "// @route POST /users 200\nexport function createUser() { return {}; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("validates against a 4xx schema when status hint is 404", async () => {
    const file = join(dir, "error-response.ts");
    // GET /users/{id} 404 schema requires: message
    await writeFile(
      file,
      "// @route GET /users/{id} 404\nexport function notFound() { return {}; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      endpoint: "GET /users/{id}",
      field: "message",
      severity: "error",
    });
  });

  it("without status hint validates against all 2xx schemas", async () => {
    const file = join(dir, "all-2xx.ts");
    await writeFile(
      file,
      "// @route POST /users\nexport function createUser(name: string, email: string) { return { id: 1, name, email }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("type drift is still detected when validating against a pinned status code", async () => {
    const file = join(dir, "type-drift.ts");
    await writeFile(
      file,
      // id should be integer per the 201 schema but is returned as string
      "// @route POST /users 201\nexport function createUser(name: string, email: string) { return { id: '1', name, email }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      endpoint: "POST /users",
      field: "id",
      expected: "integer",
      found: "string",
      severity: "warn",
    });
  });
});

describe("ScanOrchestrator — request body validation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-request-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("emits error when a required request param is missing", async () => {
    const file = join(dir, "missing-param.ts");
    await writeFile(
      file,
      // createUser only accepts `name`, missing required `email`
      "// @route POST /users\nexport function createUser(name: string) { return { id: 1, name, email: '' }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const reqViolation = violations.find(
      (v) =>
        v.endpoint === "POST /users" &&
        v.severity === "error" &&
        v.field === "email",
    );
    expect(reqViolation).toBeDefined();
  });

  it("emits no request violation when all required params are present", async () => {
    const file = join(dir, "full-params.ts");
    await writeFile(
      file,
      "// @route POST /users\nexport function createUser(name: string, email: string) { return { id: 1, name, email }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("emits no request violation when endpoint has no request schema (GET)", async () => {
    const file = join(dir, "get-full.ts");
    await writeFile(
      file,
      "// @route GET /users/{id}\nexport function getUser(id: number) { return { id: 1, name: 'x', email: 'a@b.com' }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("emits no request violation when function has no params (paramShape is null)", async () => {
    const file = join(dir, "no-params.ts");
    await writeFile(
      file,
      "// @route POST /users\nexport function createUser() { return { id: 1, name: 'x', email: 'y' }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(violations).toHaveLength(0);
  });

  it("emits request violation even when isDynamic is true (response skipped but params checked)", async () => {
    const file = join(dir, "dynamic-with-params.ts");
    await writeFile(
      file,
      "// @route POST /users\nexport function createUser(name: string) { return buildUser(name); }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(
      violations.some((v) => v.severity === "error" && v.field === "email"),
    ).toBe(true);
  });

  it("emits warn for request param type mismatch", async () => {
    const file = join(dir, "param-type-drift.ts");
    await writeFile(
      file,
      // createUser spec requires name: string, email: string — passing a number for name
      "// @route POST /users\nexport function createUser(name: number, email: string) { return { id: 1, name: String(name), email }; }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    const typeWarn = violations.find(
      (v) => v.severity === "warn" && v.field === "name",
    );
    expect(typeWarn).toMatchObject({
      endpoint: "POST /users",
      field: "name",
      expected: "string",
      found: "number",
      severity: "warn",
    });
  });

  it("emits both warn and request violation for dynamic return with missing request params", async () => {
    const file = join(dir, "dynamic-missing-param.ts");
    await writeFile(
      file,
      "// @route POST /users\nexport function createUser(name: string) { return buildUser(name); }",
    );
    const violations = await orchestrator.scan({
      specPath: SPEC,
      filePaths: [file],
    });
    expect(
      violations.some(
        (v) => v.severity === "warn" && v.field === "(return value)",
      ),
    ).toBe(true);
    expect(
      violations.some((v) => v.severity === "error" && v.field === "email"),
    ).toBe(true);
  });
});
