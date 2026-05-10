export class SpecLoadError extends Error {
  override readonly cause: Error;

  constructor(path: string, cause: Error) {
    super(`Failed to load spec at "${path}": ${cause.message}`);
    this.name = "SpecLoadError";
    this.cause = cause;
  }
}

export class AnalysisError extends Error {
  override readonly cause: Error;

  constructor(file: string, cause: Error) {
    super(`Failed to analyse "${file}": ${cause.message}`);
    this.name = "AnalysisError";
    this.cause = cause;
  }
}

export class SubprocessError extends Error {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(exitCode: number, stderr: string) {
    super(`Subprocess exited with code ${exitCode}: ${stderr}`);
    this.name = "SubprocessError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
