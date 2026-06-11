import { spawn } from "node:child_process";
import { SubprocessError } from "../../domain/Errors.js";

export interface AiViolation {
  field: string;
  expected: string;
  found: string;
  explanation: string;
}

type SubprocessRunner = (payload: string) => Promise<string>;

function spawnPython(payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-m", "contractsentry_ai"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdin.write(payload, "utf-8");
    child.stdin.end();

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new SubprocessError(code ?? 1, Buffer.concat(err).toString("utf-8")),
        );
      } else {
        resolve(Buffer.concat(out).toString("utf-8"));
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
    const parsed = JSON.parse(raw) as { violations: AiViolation[] };
    return parsed.violations ?? [];
  }
}
