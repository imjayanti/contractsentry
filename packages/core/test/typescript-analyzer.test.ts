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

  it("does not suppress when comment contains csentry-ignore as a substring", () => {
    const source = [
      "// @route GET /users/{id}",
      "// csentry-ignore-extended",
      "export function getUser() { return {}; }",
    ].join("\n");
    const shapes = new TreeSitterTypeScriptAnalyzer().analyze(source);
    expect(shapes[0]?.suppressed).toBe(false);
  });
});

describe("TreeSitterTypeScriptAnalyzer — return shapes", () => {
  it("extracts literal return shape from getUser", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.returnShape).toEqual({ id: null, name: "string" });
  });

  it("extracts literal return shape from createUser — detects type drift (id is string)", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const createUser = shapes.find((s) => s.name === "createUser");
    expect(createUser?.returnShape).toMatchObject({ id: "string", name: null });
  });

  it("extracts array return shape from listUsers", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    const listUsers = shapes.find((s) => s.name === "listUsers");
    expect(listUsers?.returnShape).toMatchObject({
      id: "integer",
      name: "string",
      email: "string",
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
    expect(shapes[0]?.returnShape).toEqual({ id: "integer", title: "string" });
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
    expect(shapes[0]?.returnShape).toEqual({ id: "integer", name: "string" });
  });

  it("handles arrow returning array without parentheses", () => {
    const source = `export const fn = () => [{ id: 1, email: "a@b.com" }];`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ id: "integer", email: "string" });
  });

  it("handles async arrow function returning an object", () => {
    const source = `export const fn = async () => ({ status: "ok" });`;
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ status: "string" });
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
    expect(shapes[0]?.returnShape).toEqual({ id: "integer" });
  });

  it("returns empty shape for all-spread return", () => {
    const source = "export function f() { return { ...other }; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toEqual({});
  });

  it("returns null returnShape for empty array return", () => {
    const source = "export function f() { return []; }";
    const analyzer = new TreeSitterTypeScriptAnalyzer();
    const shapes = analyzer.analyze(source);
    expect(shapes[0]?.returnShape).toBeNull();
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

describe("TreeSitterTypeScriptAnalyzer — value type extraction", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts integer type from a whole number literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { count: 42 }; }",
    );
    expect(shapes[0]?.returnShape?.count).toBe("integer");
  });

  it("extracts number type from a float literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { ratio: 3.14 }; }",
    );
    expect(shapes[0]?.returnShape?.ratio).toBe("number");
  });

  it("extracts string type from a string literal", () => {
    const shapes = analyzer.analyze(
      `export function f() { return { label: "hello" }; }`,
    );
    expect(shapes[0]?.returnShape?.label).toBe("string");
  });

  it("extracts boolean type from true literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { active: true }; }",
    );
    expect(shapes[0]?.returnShape?.active).toBe("boolean");
  });

  it("extracts boolean type from false literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { active: false }; }",
    );
    expect(shapes[0]?.returnShape?.active).toBe("boolean");
  });

  it("returns null type for shorthand property (value unknown)", () => {
    const shapes = analyzer.analyze("export function f() { return { id }; }");
    expect(shapes[0]?.returnShape?.id).toBeNull();
  });

  it("returns null type for identifier value (runtime value unknown)", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { id: userId }; }",
    );
    expect(shapes[0]?.returnShape?.id).toBeNull();
  });

  it("extracts integer type from a negative integer literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { offset: -1 }; }",
    );
    expect(shapes[0]?.returnShape?.offset).toBe("integer");
  });

  it("extracts number type from a negative float literal", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { delta: -3.14 }; }",
    );
    expect(shapes[0]?.returnShape?.delta).toBe("number");
  });
});

describe("TreeSitterTypeScriptAnalyzer — annotation type extraction", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts string annotation type", () => {
    const shapes = analyzer.analyze(
      "export function f(name: string) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.name).toBe("string");
  });

  it("extracts number annotation type", () => {
    const shapes = analyzer.analyze(
      "export function f(count: number) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.count).toBe("number");
  });

  it("extracts boolean annotation type", () => {
    const shapes = analyzer.analyze(
      "export function f(active: boolean) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.active).toBe("boolean");
  });

  it("returns null type for unannotated param", () => {
    const shapes = analyzer.analyze("export const f = x => x;");
    expect(shapes[0]?.paramShape?.x).toBeNull();
  });

  it("returns null type for complex type annotation", () => {
    const shapes = analyzer.analyze(
      "export function f(user: UserDto) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.user).toBeNull();
  });

  it("extracts array type from array annotation", () => {
    const shapes = analyzer.analyze(
      "export function f(tags: string[]) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.tags).toBe("array");
  });

  it("extracts array type from generic Array<T> annotation", () => {
    const shapes = analyzer.analyze(
      "export function f(items: Array<string>) { return {}; }",
    );
    expect(shapes[0]?.paramShape?.items).toBe("array");
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

  it("sets isDynamic: true for template string return", () => {
    const shapes = analyzer.analyze(
      "export function f(name: string) { return `Hello ${name}`; }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for binary expression return (&&)", () => {
    const shapes = analyzer.analyze(
      "export function f(x: boolean) { return x && getUser(); }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
  });

  it("sets isDynamic: true for binary expression return (||)", () => {
    const shapes = analyzer.analyze(
      "export function f() { return cache || fetchUser(); }",
    );
    expect(shapes[0]?.isDynamic).toBe(true);
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

describe("TreeSitterTypeScriptAnalyzer — status hint", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts status hint from @route annotation", () => {
    const shapes = analyzer.analyze(
      "// @route POST /users 201\nexport function createUser() { return {}; }",
    );
    expect(shapes[0]?.statusHint).toBe(201);
  });

  it("sets statusHint: null when no status code in @route annotation", () => {
    const shapes = analyzer.analyze(
      "// @route GET /users/{id}\nexport function getUser() { return {}; }",
    );
    expect(shapes[0]?.statusHint).toBeNull();
  });

  it("sets statusHint: null for unannotated function", () => {
    const shapes = analyzer.analyze("export function helper() { return {}; }");
    expect(shapes[0]?.statusHint).toBeNull();
  });

  it("extracts non-2xx status hint", () => {
    const shapes = analyzer.analyze(
      "// @route GET /users/{id} 404\nexport function notFound() { return {}; }",
    );
    expect(shapes[0]?.statusHint).toBe(404);
  });

  it("preserves endpointGuess alongside status hint", () => {
    const shapes = analyzer.analyze(
      "// @route PUT /users/{id} 200\nexport function updateUser() { return {}; }",
    );
    expect(shapes[0]?.endpointGuess).toBe("PUT /users/{id}");
    expect(shapes[0]?.statusHint).toBe(200);
  });

  it("all petstore fixture shapes have statusHint: null", async () => {
    const shapes = analyzer.analyze(await loadFixture());
    for (const shape of shapes) {
      expect(shape.statusHint).toBeNull();
    }
  });
});

describe("TreeSitterTypeScriptAnalyzer — nested object extraction", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts nested object as a Record (not 'object' string)", () => {
    const shapes = analyzer.analyze(
      `export function f() { return { address: { city: "NYC", zip: "10001" } }; }`,
    );
    expect(shapes[0]?.returnShape?.address).toEqual({
      city: "string",
      zip: "string",
    });
  });

  it("handles mixed flat and nested fields", () => {
    const shapes = analyzer.analyze(
      `export function f() { return { id: 1, address: { city: "NYC" } }; }`,
    );
    expect(shapes[0]?.returnShape).toEqual({
      id: "integer",
      address: { city: "string" },
    });
  });

  it("handles deeply nested objects", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { a: { b: { c: true } } }; }",
    );
    expect(shapes[0]?.returnShape).toEqual({ a: { b: { c: "boolean" } } });
  });

  it("extracts nested object inside array literal — uses first element's shape", () => {
    const shapes = analyzer.analyze(
      `export function f() { return [{ id: 1, meta: { tag: "x" } }]; }`,
    );
    expect(shapes[0]?.returnShape).toEqual({
      id: "integer",
      meta: { tag: "string" },
    });
  });

  it("nested object with mixed literal and unknown values", () => {
    const shapes = analyzer.analyze(
      `export function f() { return { address: { city: "NYC", code: zipCode } }; }`,
    );
    expect(shapes[0]?.returnShape?.address).toEqual({
      city: "string",
      code: null,
    });
  });

  it("skips computed property name keys — only static identifier keys are captured", () => {
    const shapes = analyzer.analyze(
      "export function f() { return { [someVar]: 1, id: 2 }; }",
    );
    expect(shapes[0]?.returnShape).toEqual({ id: "integer" });
    expect(Object.keys(shapes[0]?.returnShape ?? {})).not.toContain(
      "[someVar]",
    );
  });
});

describe("TreeSitterTypeScriptAnalyzer — paramShape extraction", () => {
  const analyzer = new TreeSitterTypeScriptAnalyzer();

  it("extracts named params from a function declaration", () => {
    const shapes = analyzer.analyze(
      "export function createUser(name: string, email: string) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toEqual({ name: "string", email: "string" });
  });

  it("extracts named params from an arrow function with formal parameters", () => {
    const shapes = analyzer.analyze(
      "export const f = (id: number, role: string) => ({ id });",
    );
    expect(shapes[0]?.paramShape).toEqual({ id: "number", role: "string" });
  });

  it("returns null paramShape for zero-parameter function", () => {
    const shapes = analyzer.analyze("export function f() { return {}; }");
    expect(shapes[0]?.paramShape).toBeNull();
  });

  it("includes optional parameters in paramShape", () => {
    const shapes = analyzer.analyze(
      "export function f(name: string, tag?: string) { return {}; }",
    );
    expect(shapes[0]?.paramShape).toEqual({ name: "string", tag: "string" });
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
    expect(createUser?.paramShape).toEqual({ name: "string", email: "string" });
  });

  it("populates paramShape for petstore getUser", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterTypeScriptAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "getUser");
    expect(getUser?.paramShape).toEqual({ id: "number" });
  });
});
