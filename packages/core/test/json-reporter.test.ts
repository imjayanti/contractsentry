import { describe, expect, it } from "vitest";
import type { Violation } from "../src/domain/Violation.js";
import { JsonReporter } from "../src/infrastructure/reporter/JsonReporter.js";

function v(overrides: Partial<Violation> = {}): Violation {
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

describe("JsonReporter", () => {
  it("writes a JSON object with a violations array", () => {
    const lines: string[] = [];
    const reporter = new JsonReporter((line) => lines.push(line));
    reporter.report([v()]);
    const parsed = JSON.parse(lines.join(""));
    expect(parsed).toHaveProperty("violations");
    expect(parsed.violations).toHaveLength(1);
  });

  it("includes all violation fields", () => {
    const lines: string[] = [];
    const reporter = new JsonReporter((line) => lines.push(line));
    reporter.report([v()]);
    const parsed = JSON.parse(lines.join("")) as {
      violations: Violation[];
    };
    const violation = parsed.violations[0];
    expect(violation.file).toBe("src/routes/users.ts");
    expect(violation.field).toBe("email");
    expect(violation.severity).toBe("error");
    expect(violation.suppressed).toBe(false);
  });

  it("excludes suppressed violations", () => {
    const lines: string[] = [];
    const reporter = new JsonReporter((line) => lines.push(line));
    reporter.report([v({ suppressed: true }), v({ field: "id" })]);
    const parsed = JSON.parse(lines.join("")) as {
      violations: Violation[];
    };
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0].field).toBe("id");
  });

  it("writes an empty violations array when there are none", () => {
    const lines: string[] = [];
    const reporter = new JsonReporter((line) => lines.push(line));
    reporter.report([]);
    const parsed = JSON.parse(lines.join("")) as { violations: Violation[] };
    expect(parsed.violations).toEqual([]);
  });
});
