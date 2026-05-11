import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalysisError } from "../src/domain/errors.js";
import { FileCodeAnalyzer } from "../src/infrastructure/analyzer/FileCodeAnalyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "../../../examples/petstore/routes/users.ts");

const analyzer = new FileCodeAnalyzer();

describe("FileCodeAnalyzer — petstore fixture", () => {
  it("returns a map with one entry per exported function", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    expect(shapes.size).toBe(4);
  });

  it("uses function name as map key", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    expect(shapes.has("getUser")).toBe(true);
    expect(shapes.has("listUsers")).toBe(true);
    expect(shapes.has("createUser")).toBe(true);
    expect(shapes.has("deleteUser")).toBe(true);
  });

  it("preserves endpointGuess on each shape", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    expect(shapes.get("getUser")?.endpointGuess).toBe("GET /users/{id}");
    expect(shapes.get("listUsers")?.endpointGuess).toBe("GET /users");
    expect(shapes.get("createUser")?.endpointGuess).toBe("POST /users");
  });

  it("preserves suppressed flag", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    expect(shapes.get("deleteUser")?.suppressed).toBe(true);
    expect(shapes.get("getUser")?.suppressed).toBe(false);
  });

  it("preserves returnShape", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    expect(shapes.get("getUser")?.returnShape).toEqual({
      id: null,
      name: null,
    });
  });

  it("preserves line number", async () => {
    const shapes = await analyzer.analyze(FIXTURE);
    // getUser is defined at line 5 in the fixture
    expect(shapes.get("getUser")?.line).toBe(5);
  });
});

describe("FileCodeAnalyzer — edge cases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("returns empty map for a file with no exported functions", async () => {
    const file = join(dir, "no-exports.ts");
    await writeFile(file, "const x = 42;");
    expect((await analyzer.analyze(file)).size).toBe(0);
  });

  it("returns empty map for an empty file", async () => {
    const file = join(dir, "empty.ts");
    await writeFile(file, "");
    expect((await analyzer.analyze(file)).size).toBe(0);
  });

  it("returns empty map for a file with unrecoverable syntax errors", async () => {
    const file = join(dir, "broken.ts");
    await writeFile(file, "export functoin @@@() { ??? }");
    expect((await analyzer.analyze(file)).size).toBe(0);
  });

  it("last shape wins when duplicate export names exist — overload implementation is captured", async () => {
    const file = join(dir, "overloads.ts");
    await writeFile(
      file,
      [
        "export function process(x: string): string;",
        "export function process(x: number): number;",
        "export function process(x: any): any { return { result: x }; }",
      ].join("\n"),
    );
    const shapes = await analyzer.analyze(file);
    expect(shapes.size).toBe(1);
    expect(shapes.get("process")?.returnShape).toEqual({ result: null });
  });

  it("throws AnalysisError for a missing file", async () => {
    await expect(analyzer.analyze("/non/existent/file.ts")).rejects.toThrow(
      AnalysisError,
    );
  });

  it("AnalysisError includes the file path in its message", async () => {
    await expect(analyzer.analyze("/non/existent/file.ts")).rejects.toThrow(
      "/non/existent/file.ts",
    );
  });

  it("AnalysisError retains the original cause", async () => {
    const err = await analyzer
      .analyze("/non/existent/file.ts")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect((err as AnalysisError).cause).toBeInstanceOf(Error);
  });
});
