import { watch as fsWatch } from "node:fs";
import { join, relative } from "node:path";
import {
  ConsoleReporter,
  CsentryConfigLoader,
  type IConfigLoader,
  type IReporter,
  JsonReporter,
  type ScanInput,
  ScanOrchestrator,
  type Violation,
} from "@contractsentry/core";
import fg from "fast-glob";

export interface CheckDeps {
  orchestrator?: { scan(input: ScanInput): Promise<Violation[]> };
  reporter?: IReporter;
  configLoader?: IConfigLoader;
  expandGlobs?: (patterns: string[], cwd: string) => Promise<string[]>;
  createWatcher?: (path: string, listener: () => void) => { close(): void };
}

export interface CheckOptions {
  spec?: string;
  files?: string[];
  ai?: boolean;
  audit?: boolean;
  strict?: boolean;
  format?: "table" | "json";
  watch?: boolean;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split("**")
    .map((segment) => segment.replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${regexStr}$`).test(filePath);
}

export async function runCheck(
  options: CheckOptions,
  deps: CheckDeps = {},
): Promise<number> {
  const defaultReporter =
    options.format === "json" ? new JsonReporter() : new ConsoleReporter();
  const {
    orchestrator = new ScanOrchestrator(),
    reporter = defaultReporter,
    configLoader = new CsentryConfigLoader(),
    expandGlobs = (patterns, cwd) => fg(patterns, { cwd, absolute: true }),
  } = deps;

  const cwd = process.cwd();
  const config = await configLoader.load(cwd);
  const specPath = options.spec ?? config?.spec;
  const fileGlobs: string[] = options.files ?? config?.files ?? [];

  if (!specPath) {
    throw new Error(
      "No spec path — pass --spec or set spec in csentry.config.ts",
    );
  }
  if (fileGlobs.length === 0) {
    throw new Error(
      "No files glob — pass --files or set files in csentry.config.ts",
    );
  }

  const filePaths = await expandGlobs(fileGlobs, cwd);
  const allViolations = await orchestrator.scan({
    specPath,
    filePaths,
    useAi: options.ai ?? false,
  });

  const ignorePatterns = config?.ignore ?? [];
  const violations =
    ignorePatterns.length > 0
      ? allViolations.filter(
          (violation) =>
            !ignorePatterns.some((pattern) =>
              matchesGlob(relative(cwd, violation.file), pattern),
            ),
        )
      : allViolations;

  reporter.report(violations);

  const audit = options.audit ?? config?.audit ?? false;
  if (audit) return 0;

  const strict = options.strict ?? config?.strict ?? false;
  const hasViolation = strict
    ? violations.some((violation) => !violation.suppressed)
    : violations.some(
        (violation) => !violation.suppressed && violation.severity === "error",
      );

  return hasViolation ? 1 : 0;
}

export async function runCheckWatch(
  options: CheckOptions,
  deps: CheckDeps = {},
): Promise<void> {
  const {
    configLoader = new CsentryConfigLoader(),
    expandGlobs = (patterns, cwd) => fg(patterns, { cwd, absolute: true }),
    createWatcher = (path, listener) => {
      const w = fsWatch(path, listener);
      return { close: () => w.close() };
    },
  } = deps;

  const cwd = process.cwd();
  const config = await configLoader.load(cwd);
  const specPath = options.spec ?? config?.spec;
  const fileGlobs: string[] = options.files ?? config?.files ?? [];

  if (!specPath) {
    throw new Error(
      "No spec path — pass --spec or set spec in csentry.config.ts",
    );
  }
  if (fileGlobs.length === 0) {
    throw new Error(
      "No files glob — pass --files or set files in csentry.config.ts",
    );
  }

  const run = async () => {
    console.clear();
    await runCheck(options, deps);
    const filePaths = await expandGlobs(fileGlobs, cwd);
    const watchCount = new Set([specPath, ...filePaths]).size;
    process.stderr.write(
      `\nWatching ${watchCount} file(s) for changes… (Ctrl+C to stop)\n`,
    );
  };

  await run();

  const filePaths = await expandGlobs(fileGlobs, cwd);
  // Include csentry.config.ts so config changes trigger a re-run.
  const configFilePath = join(cwd, "csentry.config.ts");
  const toWatch = [...new Set([specPath, ...filePaths, configFilePath])];

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      run().catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
      });
    }, 150);
  };

  const watchers = toWatch.flatMap((filePath) => {
    try {
      return [createWatcher(filePath, trigger)];
    } catch {
      return [];
    }
  });

  await new Promise<void>((resolve) => {
    const onSigint = () => {
      // Remove handler first to prevent double-fire during cleanup.
      process.off("SIGINT", onSigint);
      for (const w of watchers) w.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      resolve();
    };
    process.on("SIGINT", onSigint);
  });
}
