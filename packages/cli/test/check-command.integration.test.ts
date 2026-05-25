import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "../dist/bin.js");
const REPO_ROOT = join(__dirname, "../../..");

const execFileAsync = promisify(execFile);

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [BIN, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

describe("csentry check — petstore fixture", () => {
  let result: RunResult;

  beforeAll(async () => {
    result = await run([
      "check",
      "--spec",
      "examples/petstore/openapi.yaml",
      "--files",
      "examples/petstore/routes/**/*.ts",
    ]);
  }, 15_000);

  it("exits 1", () => {
    expect(result.exitCode).toBe(1);
  });

  it("reports exactly 3 violations", () => {
    expect(result.stdout).toContain("Found 3 violations");
  });

  it("reports missing email on GET /users/{id}", () => {
    expect(result.stdout).toContain("users.ts:5");
    expect(result.stdout).toContain("GET /users/{id}");
    expect(result.stdout).toContain(
      'field "email" expected present, found missing',
    );
  });

  it("reports wrong id type on POST /users", () => {
    expect(result.stdout).toContain("users.ts:16");
    expect(result.stdout).toContain("POST /users");
    expect(result.stdout).toContain(
      'field "id" expected integer, found string',
    );
  });

  it("reports missing email on POST /users", () => {
    expect(result.stdout).toContain("users.ts:16");
    expect(result.stdout).toContain("POST /users");
    expect(result.stdout).toContain(
      'field "email" expected present, found missing',
    );
  });

  it("prints a blank line before the summary", () => {
    const lines = result.stdout.split("\n");
    const summaryIndex = lines.findIndex((l) => l.startsWith("Found"));
    expect(lines[summaryIndex - 1]).toBe("");
  });

  it("produces no stderr output", () => {
    expect(result.stderr).toBe("");
  });
});

describe("csentry check — clean scan", () => {
  it("exits 0 and produces no output when glob matches no files", async () => {
    const { stdout, exitCode } = await run([
      "check",
      "--spec",
      "examples/petstore/openapi.yaml",
      "--files",
      "nonexistent/**/*.ts",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  }, 15_000);
});

describe("csentry check — error cases", () => {
  it("exits 2 and prints error when --spec is omitted", async () => {
    const { stderr, exitCode } = await run([
      "check",
      "--files",
      "examples/petstore/routes/**/*.ts",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("No spec path");
  }, 15_000);

  it("exits 2 and prints error when --files is omitted", async () => {
    const { stderr, exitCode } = await run([
      "check",
      "--spec",
      "examples/petstore/openapi.yaml",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("No files glob");
  }, 15_000);

  it("exits 2 and prints error for a missing spec file", async () => {
    const { stderr, exitCode } = await run([
      "check",
      "--spec",
      "/nonexistent/spec.yaml",
      "--files",
      "examples/petstore/routes/**/*.ts",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Failed to load spec");
  }, 15_000);
});
