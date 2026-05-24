import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TreeSitterTypeScriptAnalyzer } from "../src/infrastructure/analyzer/TreeSitterTypeScriptAnalyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "../../../examples/petstore/routes/users.ts");

async function loadFixture(): Promise<string> {
  return readFile(FIXTURE, "utf-8");
}

describe("TreeSitterTypeScriptAnalyzer — route annotations", () => {
  it("extracts @route annotations from all annotated functions", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const routes = shapes.map((s) => s.endpointGuess).filter(Boolean);
    expect(routes).toContain("GET /users/{id}");
    expect(routes).toContain("GET /users");
    expect(routes).toContain("POST /users");
  });

  it("maps function name to correct route", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.endpointGuess).toBe("GET /users/{id}");
  });

  it("returns null endpointGuess for unannotated functions", () => {
    const source = "export function helper() { return 42; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.endpointGuess).toBeNull();
  });
});

describe("TreeSitterTypeScriptAnalyzer — suppression", () => {
  it("marks csentry-ignore functions as suppressed", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const deleteUser = shapes.find((s) => s.name === "deleteUser");
    expect(deleteUser?.suppressed).toBe(true);
  });

  it("does not mark non-ignored functions as suppressed", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.suppressed).toBe(false);
  });
});

describe("TreeSitterTypeScriptAnalyzer — return shapes", () => {
  it("extracts literal return shape from getUser", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.returnShape).toEqual({ id: null, name: null });
  });

  it("extracts literal return shape from createUser — detects type drift (id is string)", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const createUser = shapes.find((s) => s.name === "createUser");
    expect(createUser?.returnShape).toMatchObject({ id: null, name: null });
  });

  it("extracts array return shape from listUsers", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const listUsers = shapes.find((s) => s.name === "listUsers");
    expect(listUsers?.returnShape).toMatchObject({
      id: null,
      name: null,
      email: null,
    });
  });

  it("returns null returnShape when function has no object literal return", () => {
    const source =
      "export function greet(name: string) { return `Hello ${name}`; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toBeNull();
  });

  it("extracts return shape from inline arrow function", () => {
    const source = `export const getItem = () => ({ id: 1, title: "thing" });`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ id: null, title: null });
  });
});

describe("TreeSitterTypeScriptAnalyzer — line numbers", () => {
  it("reports 1-based line number for each function", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    for (const shape of shapes) {
      expect(shape.line).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports correct line for getUser", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    // getUser is defined at line 5 in the fixture
    expect(getUser?.line).toBe(5);
  });
});

describe("TreeSitterTypeScriptAnalyzer — function coverage", () => {
  it("finds all 4 exported functions in the fixture", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes).toHaveLength(4);
  });

  it("returns empty array for empty source", () => {
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    expect(analyzer.analyze("")).toHaveLength(0);
  });

  it("returns empty array for source with no functions", () => {
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    expect(analyzer.analyze("const x = 42;")).toHaveLength(0);
  });

  it("skips non-exported functions", () => {
    const source = "function internal() { return { id: 1 }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    expect(analyzer.analyze(source)).toHaveLength(0);
  });
});

describe("TreeSitterTypeScriptAnalyzer — arrow function variants", () => {
  it("handles arrow function with block body", () => {
    const source = `export const fn = () => { return { id: 1, name: "x" }; };`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ id: null, name: null });
  });

  it("handles arrow returning array without parentheses", () => {
    const source = `export const fn = () => [{ id: 1, email: "a@b.com" }];`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ id: null, email: null });
  });

  it("handles async arrow function returning an object", () => {
    const source = `export const fn = async () => ({ status: "ok" });`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ status: null });
  });

  it("returns null for arrow returning a primitive", () => {
    const source = "export const fn = () => 42;";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toBeNull();
  });

  it("returns null for arrow returning a string", () => {
    const source = `export const fn = () => "hello";`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toBeNull();
  });
});

describe("TreeSitterTypeScriptAnalyzer — object spread", () => {
  it("extracts only statically-known keys — spread elements are skipped", () => {
    const source =
      "export function f() { const base = {}; return { ...base, id: 1 }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    // spread_element is intentionally skipped; only 'id' is known statically
    expect(shapes[0]?.returnShape).toEqual({ id: null });
  });

  it("returns empty shape for all-spread return", () => {
    const source = "export function f() { return { ...other }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({});
  });
});

describe("TreeSitterTypeScriptAnalyzer — export default", () => {
  it("captures export default function with a name", () => {
    const source = "export default function getUser() { return { id: 1 }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.name).toBe("getUser");
  });

  it("skips anonymous export default function", () => {
    const source = "export default function() { return { id: 1 }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    // anonymous function has no name node — fromFunctionDecl returns null
    expect(analyzer.analyze(source)).toHaveLength(0);
  });
});

describe("TreeSitterTypeScriptAnalyzer — isDynamic detection", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("sets isDynamic: false for static object literal return", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { id: 1 }; }",
    );
    expect(shapes[0]?.isDynamic).toBe(false);
  });

  it("sets isDynamic: true for identifier return", () => {
    const shapes = analyzer.analyze("export function f() { return result; }");
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for call expression return", () => {
    const shapes = analyzer.analyze(
      "export function f() { return buildResponse(); }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for member expression return", () => {
    const shapes = analyzer.analyze("export function f() { return obj.data; }");
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for await expression return", () => {
    const shapes = analyzer.analyze(
      "export const f = async () => { return await fetchUser(); };",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for ternary expression return", () => {
    const shapes = analyzer.analyze(
      "export function f(x: boolean) { return x ? { a: 1 } : null; }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for new expression return", () => {
    const shapes = analyzer.analyze(
      "export function f() { return new Response(); }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for as expression return", () => {
    const shapes = analyzer.analyze(
      "export function f() { return data as User; }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for arrow function returning identifier", () => {
    const shapes = analyzer.analyze("export const f = () => result;");
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for arrow function returning call expression", () => {
    const shapes = analyzer.analyze("export const f = () => build();");
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: false and returnShape: null for function with no return", () => {
    const shapes = analyzer.analyze("export function f() {}");
    expect(shapes[0]?.isDynamic).toBe(false);
    expect(shapes[0]?.returnShape).toBeNull();
  });

  it("sets isDynamic: false for primitive number return", () => {
    const shapes = analyzer.analyze("export function f() { return 42; }");
    expect(shapes[0]?.isDynamic).toBe(false);
  });

  it("sets isDynamic: false for primitive string return", () => {
    const shapes = analyzer.analyze(`export const f = () => "hello";`);
    expect(shapes[0]?.isDynamic).toBe(false);
  });
});

describe("TreeSitterTypeScriptAnalyzer — isDynamic with petstore fixture", () => {
  it("all petstore functions have isDynamic: false", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    for (const shape of shapes) {
      expect(shape.isDynamic).toBe(false);
    }
  });
});

describe("TreeSitterTypeScriptAnalyzer — paramShape extraction", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts named params from a function declaration", () => {
    const shapes = analyzer.analyze(
      "export function createUser(name: string, email: string) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toEqual({ name: null, email: null });
  });

  it("extracts named params from an arrow function with formal parameters", () => {
    const shapes = analyzer.analyze(
      "export const f = (id: number, role: string) => ({ id });",
    );
    expect(shapes[0]?.paramShape).toEqual({ id: null, role: null });
  });

  it("returns null paramShape for zero-parameter function", () => {
    const shapes = analyzer.analyze("export function f() { return {}; }");
    expect(shapes[0]?.paramShape).toBeNull();
  });

  it("includes optional parameters in paramShape", () => {
    const shapes = analyzer.analyze(
      "export function f(name: string, tag?: string) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toEqual({ name: null, tag: null });
  });

  it("returns null paramShape for rest-only parameter", () => {
    const shapes = analyzer.analyze(
      "export function f(...args: string[]) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toBeNull();
  });

  it("extracts paramShape for single-param arrow without parentheses", () => {
    const shapes = analyzer.analyze("export const f = x => x;");
    expect(shapes[0]?.paramShape).toEqual({ x: null });
  });

  it("returns null paramShape for destructured parameter", () => {
    const shapes = analyzer.analyze(
      "export function f({ id }: { id: number }) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toBeNull();
  });

  it("populates paramShape for petstore createUser", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterTypeScriptAnalyzer().analyze(source);
    const createUser = shapes.find((s) => s.name === "createUser");
    expect(createUser?.paramShape).toEqual({ name: null, email: null });
  });

  it("populates paramShape for petstore getUser", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterTypeScriptAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.paramShape).toEqual({ id: null });
  });
});
