import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TreeSitterPythonAnalyzer } from "../src/infrastructure/analyzer/TreeSitterPythonAnalyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "../../../examples/fastapi-demo/main.py");

async function loadFixture(): Promise<string> {
  return readFile(FIXTURE, "utf-8");
}

describe("TreeSitterPythonAnalyzer — route decorators", () => {
  it("extracts endpoints from all decorated functions", async () => {
    const source = await loadFixture();
    const analyzer = new TreeSitterPythonAnalyzer();
    const shapes = analyzer.analyze(source);
    const endpoints = shapes.map((s) => s.endpointGuess).filter(Boolean);
    expect(endpoints).toContain("GET /users/{user_id}");
    expect(endpoints).toContain("GET /users");
    expect(endpoints).toContain("POST /users");
    expect(endpoints).toContain("DELETE /users/{user_id}");
  });

  it("maps function name to correct endpoint", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "get_user");
    expect(getUser?.endpointGuess).toBe("GET /users/{user_id}");
  });

  it("returns null endpointGuess for plain functions without route decorators", () => {
    const source = "def helper():\n    return 42\n";
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes).toHaveLength(0);
  });

  it("extracts correct HTTP method from @app.route with methods kwarg", () => {
    const source = [
      '@app.route("/health", methods=["POST"])',
      "def health_check():",
      '    return {"status": "ok"}',
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("POST /health");
  });

  it("extracts DELETE method from @router.delete decorator", () => {
    const source = [
      '@router.delete("/items/{item_id}")',
      "def remove_item(item_id: int):",
      '    return {"deleted": item_id}',
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("DELETE /items/{item_id}");
  });
});

describe("TreeSitterPythonAnalyzer — suppression", () => {
  it("marks csentry-ignore functions as suppressed", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const deleteUser = shapes.find((s) => s.name === "delete_user");
    expect(deleteUser?.suppressed).toBe(true);
  });

  it("does not mark non-ignored functions as suppressed", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "get_user");
    expect(getUser?.suppressed).toBe(false);
  });

  it("does not suppress when comment contains csentry-ignore as a substring", () => {
    const source = [
      "# csentry-ignore-extended",
      '@router.get("/users")',
      "def list_users():",
      "    return []",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.suppressed).toBe(false);
  });
});

describe("TreeSitterPythonAnalyzer — return shapes", () => {
  it("extracts return shape from get_user — dict with identifier and string values", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "get_user");
    expect(getUser?.returnShape).toEqual({ id: null, name: '"Alice"' });
    expect(getUser?.isDynamic).toBe(false);
  });

  it("extracts return shape from list_users — first element of list", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const listUsers = shapes.find((s) => s.name === "list_users");
    expect(listUsers?.returnShape).toEqual({
      id: "integer",
      name: '"Alice"',
      email: '"alice@example.com"',
    });
    expect(listUsers?.isDynamic).toBe(false);
  });

  it("detects string literal id drift in create_user", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const createUser = shapes.find((s) => s.name === "create_user");
    expect(createUser?.returnShape).toEqual({ id: '"1"', name: null });
  });

  it("detects dynamic returns and sets isDynamic", () => {
    const source = [
      '@router.get("/users/{user_id}")',
      "async def get_user(user_id: int):",
      "    result = db.query(user_id)",
      "    return result",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.isDynamic).toBe(true);
    expect(shapes[0]?.returnShape).toBeNull();
  });

  it("extracts integer, float, boolean field types", () => {
    const source = [
      '@router.get("/stats")',
      "def get_stats():",
      "    return {",
      '        "count": 42,',
      '        "ratio": 0.5,',
      '        "active": True,',
      "    }",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.returnShape).toEqual({
      count: "integer",
      ratio: "number",
      active: "boolean",
    });
  });
});

describe("TreeSitterPythonAnalyzer — line numbers", () => {
  it("reports line of the decorator (@) as the function line", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    const getUser = shapes.find((s) => s.name === "get_user");
    expect(getUser?.line).toBe(6);
    const createUser = shapes.find((s) => s.name === "create_user");
    expect(createUser?.line).toBe(15);
  });
});

describe("TreeSitterPythonAnalyzer — edge cases", () => {
  it("returns empty array for empty source", () => {
    const shapes = new TreeSitterPythonAnalyzer().analyze("");
    expect(shapes).toHaveLength(0);
  });

  it("returns empty array for source with only imports", () => {
    const source = "from fastapi import APIRouter\nrouter = APIRouter()\n";
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes).toHaveLength(0);
  });

  it("sets paramShape to null", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    for (const shape of shapes) {
      expect(shape.paramShape).toBeNull();
    }
  });

  it("sets statusHint to null", async () => {
    const source = await loadFixture();
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    for (const shape of shapes) {
      expect(shape.statusHint).toBeNull();
    }
  });

  it("defaults Flask route method to GET when no methods kwarg", () => {
    const source = [
      '@app.route("/health")',
      "def health_check():",
      '    return {"status": "ok"}',
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /health");
  });

  it("extracts nested dict as nested FieldShapeRecord", () => {
    const source = [
      '@router.get("/profile")',
      "def get_profile():",
      "    return {",
      '        "user": {"id": 1, "name": "Alice"},',
      '        "active": True,',
      "    }",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.returnShape).toEqual({
      user: { id: "integer", name: '"Alice"' },
      active: "boolean",
    });
  });

  it("suppresses when csentry-ignore is separated by an intermediate comment", () => {
    const source = [
      "# csentry-ignore",
      "# additional note about this function",
      '@router.delete("/users/{user_id}")',
      "async def delete_user(user_id: int):",
      "    return {}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.suppressed).toBe(true);
  });

  it("does not suppress when an assignment separates comment from decorator", () => {
    const source = [
      "# csentry-ignore",
      "x = 5",
      '@router.delete("/users/{user_id}")',
      "async def delete_user(user_id: int):",
      "    return {}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.suppressed).toBe(false);
  });

  it("handles single-quoted string values", () => {
    const source = [
      '@router.get("/status")',
      "def get_status():",
      "    return {'status': 'ok'}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.returnShape).toEqual({ status: "'ok'" });
  });
});

describe("TreeSitterPythonAnalyzer — prefix detection", () => {
  it("prepends APIRouter(prefix=...) to route paths", () => {
    const source = [
      'router = APIRouter(prefix="/users")',
      '@router.get("/{user_id}")',
      "async def get_user(user_id: int):",
      "    return {'id': 1}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /users/{user_id}");
  });

  it("prepends APIRouter prefix for multiple HTTP methods", () => {
    const source = [
      'router = APIRouter(prefix="/items")',
      '@router.get("/")',
      "async def list_items():",
      "    return {'items': []}",
      '@router.post("/")',
      "async def create_item():",
      "    return {'id': 1}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes.find((s) => s.endpointGuess === "GET /items/")).toBeDefined();
    expect(
      shapes.find((s) => s.endpointGuess === "POST /items/"),
    ).toBeDefined();
  });

  it("ignores APIRouter() with no prefix kwarg", () => {
    const source = [
      "router = APIRouter()",
      '@router.get("/users")',
      "async def list_users():",
      "    return {}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /users");
  });

  it("applies # csentry-prefix to all routes in the file", () => {
    const source = [
      "# csentry-prefix /api/v1",
      '@router.get("/users")',
      "async def list_users():",
      "    return {}",
      '@router.post("/users")',
      "async def create_user():",
      "    return {}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(
      shapes.find((s) => s.endpointGuess === "GET /api/v1/users"),
    ).toBeDefined();
    expect(
      shapes.find((s) => s.endpointGuess === "POST /api/v1/users"),
    ).toBeDefined();
  });

  it("combines # csentry-prefix with APIRouter(prefix=...)", () => {
    const source = [
      "# csentry-prefix /api/v1",
      'router = APIRouter(prefix="/users")',
      '@router.get("/{id}")',
      "async def get_user(id: int):",
      "    return {'id': 1}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /api/v1/users/{id}");
  });

  it("does not apply prefix to routes on a different router variable", () => {
    const source = [
      'users_router = APIRouter(prefix="/users")',
      '@app.get("/health")',
      "async def health():",
      "    return {'ok': True}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /health");
  });

  it("avoids double slash when prefix has a trailing slash", () => {
    const source = [
      'router = APIRouter(prefix="/users/")',
      '@router.get("/{id}")',
      "async def get_user(id: int):",
      "    return {'id': 1}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /users/{id}");
  });

  it("detects prefix on type-annotated APIRouter assignment", () => {
    const source = [
      'router: APIRouter = APIRouter(prefix="/users")',
      '@router.get("/{id}")',
      "async def get_user(id: int):",
      "    return {'id': 1}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /users/{id}");
  });

  it("avoids double slash when csentry-prefix has a trailing slash", () => {
    const source = [
      "# csentry-prefix /api/v1/",
      '@router.get("/users")',
      "async def list_users():",
      "    return {}",
    ].join("\n");
    const shapes = new TreeSitterPythonAnalyzer().analyze(source);
    expect(shapes[0]?.endpointGuess).toBe("GET /api/v1/users");
  });
});
