import type { Violation } from "@contractsentry/core";
import { describe, expect, it, vi } from "vitest";
import { type CheckDeps, runCheck } from "../src/commands/check.js";

function makeDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    orchestrator: { scan: vi.fn().mockResolvedValue([]) },
    reporter: { report: vi.fn() },
    configLoader: { load: vi.fn().mockResolvedValue(null) },
    expandGlobs: vi.fn().mockResolvedValue(["src/routes/users.ts"]),
    ...overrides,
  };
}

function violation(overrides: Partial<Violation> = {}): Violation {
  return {
    file: "src/routes/users.ts",
    line: 5,
    endpoint: "GET /users/{id}",
    field: "email",
    expected: "present",
    found: "missing",
    severity: "error",
    suppressed: false,
    ...overrides,
  };
}

describe("runCheck — exit codes", () => {
  it("returns 0 when orchestrator returns no violations", async () => {
    const code = await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps(),
    );
    expect(code).toBe(0);
  });

  it("returns 1 when there is at least one non-suppressed violation", async () => {
    const scan = vi.fn().mockResolvedValue([violation()]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(1);
  });

  it("returns 0 when all violations are suppressed", async () => {
    const scan = vi.fn().mockResolvedValue([violation({ suppressed: true })]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(0);
  });
});

describe("runCheck — config and option resolution", () => {
  it("reads spec and files from config when CLI options are absent", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      {},
      makeDeps({
        orchestrator: { scan },
        configLoader: {
          load: vi
            .fn()
            .mockResolvedValue({ spec: "api.yaml", files: ["src/**/*.ts"] }),
        },
      }),
    );
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ specPath: "api.yaml" }),
    );
  });

  it("CLI --spec overrides config spec", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      { spec: "cli.yaml" },
      makeDeps({
        orchestrator: { scan },
        configLoader: {
          load: vi
            .fn()
            .mockResolvedValue({ spec: "config.yaml", files: ["src/**/*.ts"] }),
        },
      }),
    );
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ specPath: "cli.yaml" }),
    );
  });

  it("CLI --files overrides config files", async () => {
    const expandGlobs = vi.fn().mockResolvedValue(["cli/routes.ts"]);
    await runCheck(
      { spec: "api.yaml", files: "cli/**/*.ts" },
      makeDeps({
        configLoader: {
          load: vi
            .fn()
            .mockResolvedValue({ spec: "api.yaml", files: ["config/**/*.ts"] }),
        },
        expandGlobs,
      }),
    );
    expect(expandGlobs).toHaveBeenCalledWith(
      ["cli/**/*.ts"],
      expect.any(String),
    );
  });

  it("passes expanded file paths to orchestrator", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    const expandGlobs = vi
      .fn()
      .mockResolvedValue(["/abs/src/routes.ts", "/abs/src/users.ts"]);
    await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps({ orchestrator: { scan }, expandGlobs }),
    );
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({
        filePaths: ["/abs/src/routes.ts", "/abs/src/users.ts"],
      }),
    );
  });

  it("calls reporter.report with violations from orchestrator", async () => {
    const v = violation();
    const report = vi.fn();
    await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps({
        orchestrator: { scan: vi.fn().mockResolvedValue([v]) },
        reporter: { report },
      }),
    );
    expect(report).toHaveBeenCalledWith([v]);
  });

  it("expands multiple file globs from config", async () => {
    const expandGlobs = vi.fn().mockResolvedValue(["src/a.ts", "lib/b.ts"]);
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      { spec: "api.yaml" },
      makeDeps({
        configLoader: {
          load: vi.fn().mockResolvedValue({
            spec: "api.yaml",
            files: ["src/**/*.ts", "lib/**/*.ts"],
          }),
        },
        expandGlobs,
        orchestrator: { scan },
      }),
    );
    expect(expandGlobs).toHaveBeenCalledWith(
      ["src/**/*.ts", "lib/**/*.ts"],
      expect.any(String),
    );
  });
});

describe("runCheck — error cases", () => {
  it("throws when no spec path is resolved", async () => {
    await expect(
      runCheck({ files: "src/**/*.ts" }, makeDeps()),
    ).rejects.toThrow(/spec/i);
  });

  it("throws when no files glob is resolved", async () => {
    await expect(
      runCheck({ spec: "openapi.yaml" }, makeDeps()),
    ).rejects.toThrow(/files/i);
  });

  it("throws when config returns empty files array and no --files flag", async () => {
    await expect(
      runCheck(
        { spec: "openapi.yaml" },
        makeDeps({
          configLoader: {
            load: vi.fn().mockResolvedValue({ spec: "api.yaml", files: [] }),
          },
        }),
      ),
    ).rejects.toThrow(/files/i);
  });

  it("propagates errors from orchestrator", async () => {
    await expect(
      runCheck(
        { spec: "openapi.yaml", files: "src/**/*.ts" },
        makeDeps({
          orchestrator: {
            scan: vi.fn().mockRejectedValue(new Error("scan failed")),
          },
        }),
      ),
    ).rejects.toThrow("scan failed");
  });

  it("propagates errors from configLoader", async () => {
    await expect(
      runCheck(
        { spec: "openapi.yaml", files: "src/**/*.ts" },
        makeDeps({
          configLoader: {
            load: vi.fn().mockRejectedValue(new Error("config syntax error")),
          },
        }),
      ),
    ).rejects.toThrow("config syntax error");
  });

  it("returns 0 when expandGlobs matches no files", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: "src/**/*.ts" },
      makeDeps({
        orchestrator: { scan },
        expandGlobs: vi.fn().mockResolvedValue([]),
      }),
    );
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ filePaths: [] }),
    );
    expect(code).toBe(0);
  });
});
