import { execSync, spawn } from "node:child_process";
import { SubprocessError } from "../../domain/Errors.js";

export interface AiViolation {
  field: string;
  expected: string;
  found: string;
  explanation: string;
}

type SubprocessRunner = (payload: string) => Promise<string>;

let pythonExecutable: string | undefined;

function getPythonExecutable(): string {
  if (pythonExecutable) return pythonExecutable;
  for (const candidate of ["python3", "python"]) {
    try {
      execSync(`${candidate} --version`, { stdio: "pipe" });
      pythonExecutable = candidate;
      return candidate;
    } catch {}
  }
  throw new Error("No python3 or python found in PATH");
}

function spawnPython(payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(getPythonExecutable(), ["-m", "contractsentry_ai"]);
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.stdin.on("error", reject);
    child.stdin.write(payload, "utf-8");
    child.stdin.end();

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new SubprocessError(
            code ?? 1,
            Buffer.concat(errorChunks).toString("utf-8"),
          ),
        );
      } else {
        resolve(Buffer.concat(outputChunks).toString("utf-8"));
      }
    });
  });
}

export class AiBridgeAnalyzer {
  constructor(private readonly runner: SubprocessRunner = spawnPython) {}

  async analyzeEndpoint(
    endpoint: string,
    schema: Record<string, unknown>,
    codeSnippet: string,
  ): Promise<AiViolation[]> {
    const payload = JSON.stringify({
      protocol_version: 1,
      endpoint,
      schema,
      code_snippet: codeSnippet,
    });

    const raw = await this.runner(payload);
    let parsed: { violations: AiViolation[] };
    try {
      parsed = JSON.parse(raw) as { violations: AiViolation[] };
    } catch {
      throw new SubprocessError(
        1,
        `Invalid JSON from Python subprocess: ${raw}`,
      );
    }
    return parsed.violations ?? [];
  }
}
