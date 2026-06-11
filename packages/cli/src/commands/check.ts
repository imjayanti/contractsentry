import { relative } from "node:path";
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
}

export interface CheckOptions {
  spec?: string;
  files?: string[];
  ai?: boolean;
  audit?: boolean;
  strict?: boolean;
  format?: "table" | "json";
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
          (v) =>
            !ignorePatterns.some((p) => matchesGlob(relative(cwd, v.file), p)),
        )
      : allViolations;

  reporter.report(violations);

  const audit = options.audit ?? config?.audit ?? false;
  if (audit) return 0;

  const strict = options.strict ?? config?.strict ?? false;
  const hasViolation = strict
    ? violations.some((v) => !v.suppressed)
    : violations.some((v) => !v.suppressed && v.severity === "error");

  return hasViolation ? 1 : 0;
}
