import { describe, expect, it } from "vitest";
import {
  AnalysisError,
  SpecLoadError,
  SubprocessError,
} from "../src/domain/errors.js";

describe("SpecLoadError", () => {
  const cause = new Error("file not found");
  const err = new SpecLoadError("/api/openapi.yaml", cause);

  it("sets name to SpecLoadError", () => {
    expect(err.name).toBe("SpecLoadError");
  });

  it("includes path and cause message in message", () => {
    expect(err.message).toContain("/api/openapi.yaml");
    expect(err.message).toContain("file not found");
  });

  it("retains the original cause", () => {
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    expect(err).toBeInstanceOf(Error);
  });
});

describe("AnalysisError", () => {
  const cause = new Error("parse failed");
  const err = new AnalysisError("src/routes/users.ts", cause);

  it("sets name to AnalysisError", () => {
    expect(err.name).toBe("AnalysisError");
  });

  it("includes file path and cause message in message", () => {
    expect(err.message).toContain("src/routes/users.ts");
    expect(err.message).toContain("parse failed");
  });

  it("retains the original cause", () => {
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    expect(err).toBeInstanceOf(Error);
  });
});

describe("SubprocessError", () => {
  const err = new SubprocessError(1, "command not found");

  it("sets name to SubprocessError", () => {
    expect(err.name).toBe("SubprocessError");
  });

  it("includes exit code and stderr in message", () => {
    expect(err.message).toContain("1");
    expect(err.message).toContain("command not found");
  });

  it("exposes exitCode as a structured field", () => {
    expect(err.exitCode).toBe(1);
  });

  it("exposes stderr as a structured field", () => {
    expect(err.stderr).toBe("command not found");
  });

  it("is an instance of Error", () => {
    expect(err).toBeInstanceOf(Error);
  });
});
