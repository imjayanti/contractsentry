import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnalysisError, SpecLoadError } from "../src/domain/errors.js";
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

  it("returns 2 violations for the petstore fixture", () => {
    expect(violations).toHaveLength(2);
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
    const v = violations.find((v) => v.endpoint === "POST /users");
    expect(v).toMatchObject({
      endpoint: "POST /users",
      field: "email",
      severity: "error",
    });
  });

  it("produces no violations for listUsers — array schema has no top-level required", () => {
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
