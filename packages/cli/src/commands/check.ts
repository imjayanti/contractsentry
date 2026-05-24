import {
  ConsoleReporter,
  CsentryConfigLoader,
  type IConfigLoader,
  type IReporter,
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
  files?: string;
}

export async function runCheck(
  options: CheckOptions,
  deps: CheckDeps = {},
): Promise<number> {
  const {
    orchestrator = new ScanOrchestrator(),
    reporter = new ConsoleReporter(),
    configLoader = new CsentryConfigLoader(),
    expandGlobs = (patterns, cwd) => fg(patterns, { cwd, absolute: true }),
  } = deps;

  const cwd = process.cwd();
  const config = await configLoader.load(cwd);
  const specPath = options.spec ?? config?.spec;
  const fileGlobs: string[] = options.files
    ? [options.files]
    : (config?.files ?? []);

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
  const violations = await orchestrator.scan({ specPath, filePaths });
  reporter.report(violations);

  return violations.some((v) => !v.suppressed && v.severity === "error")
    ? 1
    : 0;
}
