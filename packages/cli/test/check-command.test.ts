import { JsonReporter, type Violation } from "@contractsentry/core";
import { describe, expect, it, vi } from "vitest";
import {
  type CheckDeps,
  runCheck,
  runCheckWatch,
} from "../src/commands/check.js";

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
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps(),
    );
    expect(code).toBe(0);
  });

  it("returns 1 when there is at least one non-suppressed violation", async () => {
    const scan = vi.fn().mockResolvedValue([violation()]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(1);
  });

  it("returns 0 when all violations are suppressed", async () => {
    const scan = vi.fn().mockResolvedValue([violation({ suppressed: true })]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(0);
  });

  it("returns 0 when only warn violations are present (non-suppressed)", async () => {
    const scan = vi
      .fn()
      .mockResolvedValue([violation({ severity: "warn", suppressed: false })]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(0);
  });

  it("returns 1 when error violation is present alongside warn", async () => {
    const scan = vi
      .fn()
      .mockResolvedValue([
        violation({ severity: "warn" }),
        violation({ severity: "error" }),
      ]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(1);
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
      { spec: "api.yaml", files: ["cli/**/*.ts"] },
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
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
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
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
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
      runCheck({ files: ["src/**/*.ts"] }, makeDeps()),
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
        { spec: "openapi.yaml", files: ["src/**/*.ts"] },
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
        { spec: "openapi.yaml", files: ["src/**/*.ts"] },
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
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
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

describe("runCheck — --ai flag", () => {
  it("passes useAi: true to the orchestrator when ai option is set", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], ai: true },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ useAi: true }));
  });

  it("passes useAi: false when ai option is not set", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ useAi: false }),
    );
  });
});

describe("runCheck — --audit flag", () => {
  it("returns 0 even when there are error violations", async () => {
    const scan = vi.fn().mockResolvedValue([violation()]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], audit: true },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(0);
  });

  it("still reports violations to the reporter", async () => {
    const report = vi.fn();
    const scan = vi.fn().mockResolvedValue([violation()]);
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], audit: true },
      makeDeps({ orchestrator: { scan }, reporter: { report } }),
    );
    expect(report).toHaveBeenCalledWith(expect.arrayContaining([violation()]));
  });
});

describe("runCheck — --strict flag", () => {
  it("returns 1 when there are only warn violations", async () => {
    const scan = vi.fn().mockResolvedValue([violation({ severity: "warn" })]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], strict: true },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(1);
  });

  it("returns 0 when all violations are suppressed", async () => {
    const scan = vi
      .fn()
      .mockResolvedValue([violation({ severity: "warn", suppressed: true })]);
    const code = await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], strict: true },
      makeDeps({ orchestrator: { scan } }),
    );
    expect(code).toBe(0);
  });
});

describe("runCheck — config.ignore", () => {
  it("filters violations whose file matches an ignore pattern", async () => {
    const report = vi.fn();
    const absFile = `${process.cwd()}/src/generated/types.ts`;
    const v = violation({ file: absFile });
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({
        orchestrator: { scan: vi.fn().mockResolvedValue([v]) },
        reporter: { report },
        configLoader: {
          load: vi.fn().mockResolvedValue({
            spec: "openapi.yaml",
            files: ["src/**/*.ts"],
            ignore: ["src/generated/**"],
          }),
        },
        expandGlobs: vi.fn().mockResolvedValue([absFile]),
      }),
    );
    expect(report).toHaveBeenCalledWith([]);
  });

  it("keeps violations whose file does not match any ignore pattern", async () => {
    const report = vi.fn();
    const absFile = `${process.cwd()}/src/routes/users.ts`;
    const v = violation({ file: absFile });
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({
        orchestrator: { scan: vi.fn().mockResolvedValue([v]) },
        reporter: { report },
        configLoader: {
          load: vi.fn().mockResolvedValue({
            spec: "openapi.yaml",
            files: ["src/**/*.ts"],
            ignore: ["src/generated/**"],
          }),
        },
        expandGlobs: vi.fn().mockResolvedValue([absFile]),
      }),
    );
    expect(report).toHaveBeenCalledWith([v]);
  });

  it("passes all violations through when ignore is absent", async () => {
    const report = vi.fn();
    const v = violation();
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      makeDeps({
        orchestrator: { scan: vi.fn().mockResolvedValue([v]) },
        reporter: { report },
      }),
    );
    expect(report).toHaveBeenCalledWith([v]);
  });
});

describe("runCheckWatch", () => {
  function makeWatchDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
    return {
      orchestrator: { scan: vi.fn().mockResolvedValue([]) },
      reporter: { report: vi.fn() },
      configLoader: { load: vi.fn().mockResolvedValue(null) },
      expandGlobs: vi.fn().mockResolvedValue(["src/routes/users.ts"]),
      createWatcher: vi.fn().mockReturnValue({ close: vi.fn() }),
      ...overrides,
    };
  }

  it("calls runCheck immediately on start", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    const deps = makeWatchDeps({ orchestrator: { scan } });

    // Abort via SIGINT after first run completes
    const watchPromise = runCheckWatch(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      deps,
    );
    // Give the initial run time to complete then send SIGINT
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await watchPromise;

    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("sets up a watcher for each file and the spec", async () => {
    const createWatcher = vi.fn().mockReturnValue({ close: vi.fn() });
    const deps = makeWatchDeps({ createWatcher });

    const watchPromise = runCheckWatch(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      deps,
    );
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await watchPromise;

    // spec + 1 expanded file = 2 watchers
    expect(createWatcher).toHaveBeenCalledTimes(2);
    const paths = createWatcher.mock.calls.map((c) => c[0]);
    expect(paths).toContain("openapi.yaml");
    expect(paths).toContain("src/routes/users.ts");
  });

  it("closes all watchers on SIGINT", async () => {
    const close = vi.fn();
    const deps = makeWatchDeps({
      createWatcher: vi.fn().mockReturnValue({ close }),
    });

    const watchPromise = runCheckWatch(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      deps,
    );
    await new Promise((r) => setTimeout(r, 20));
    process.emit("SIGINT");
    await watchPromise;

    expect(close).toHaveBeenCalled();
  });

  it("re-runs check when watcher triggers after debounce", async () => {
    const scan = vi.fn().mockResolvedValue([]);
    let triggerChange: (() => void) | undefined;
    const createWatcher = vi.fn().mockImplementation((_path, listener) => {
      triggerChange = listener;
      return { close: vi.fn() };
    });
    const deps = makeWatchDeps({ orchestrator: { scan }, createWatcher });

    const watchPromise = runCheckWatch(
      { spec: "openapi.yaml", files: ["src/**/*.ts"] },
      deps,
    );
    await new Promise((r) => setTimeout(r, 20));

    // Trigger a file change and wait for debounce (150ms) + run
    triggerChange?.();
    await new Promise((r) => setTimeout(r, 200));

    process.emit("SIGINT");
    await watchPromise;

    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe("runCheck — --format flag", () => {
  it("uses JsonReporter when format is json", async () => {
    const spy = vi
      .spyOn(JsonReporter.prototype, "report")
      .mockImplementation(() => {});
    const scan = vi.fn().mockResolvedValue([]);
    await runCheck(
      { spec: "openapi.yaml", files: ["src/**/*.ts"], format: "json" },
      makeDeps({ orchestrator: { scan }, reporter: undefined }),
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
