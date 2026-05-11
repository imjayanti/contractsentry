import { describe, expect, it } from "vitest";
import type { Violation } from "../src/domain/Violation.js";
import { ConsoleReporter } from "../src/infrastructure/reporter/ConsoleReporter.js";

function capture(): { reporter: ConsoleReporter; lines: () => string[] } {
  const output: string[] = [];
  return {
    reporter: new ConsoleReporter((line) => output.push(line)),
    lines: () => output,
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

describe("ConsoleReporter — empty violations", () => {
  it("produces no output when violations array is empty", () => {
    const { reporter, lines } = capture();
    reporter.report([]);
    expect(lines()).toHaveLength(0);
  });

  it("produces no output when all violations are suppressed", () => {
    const { reporter, lines } = capture();
    reporter.report([
      violation({ suppressed: true }),
      violation({ suppressed: true }),
    ]);
    expect(lines()).toHaveLength(0);
  });
});

describe("ConsoleReporter — violation lines", () => {
  it("prints one line per actionable violation", () => {
    const { reporter, lines } = capture();
    reporter.report([violation(), violation({ field: "name" })]);
    const nonEmptyLines = lines().filter((l) => l !== "");
    expect(nonEmptyLines).toHaveLength(3); // 2 violations + summary
  });

  it("outputs violations in input order", () => {
    const { reporter, lines } = capture();
    reporter.report([
      violation({ field: "alpha" }),
      violation({ field: "beta" }),
      violation({ field: "gamma" }),
    ]);
    expect(lines()[0]).toContain('field "alpha"');
    expect(lines()[1]).toContain('field "beta"');
    expect(lines()[2]).toContain('field "gamma"');
  });

  it("includes file and line number in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ file: "src/routes/users.ts", line: 12 })]);
    expect(lines()[0]).toContain("src/routes/users.ts:12");
  });

  it("includes severity in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ severity: "error" })]);
    expect(lines()[0]).toContain("error");
  });

  it("includes warn severity in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ severity: "warn" })]);
    expect(lines()[0]).toContain("warn");
  });

  it("includes endpoint in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ endpoint: "POST /users" })]);
    expect(lines()[0]).toContain("POST /users");
  });

  it("includes field name in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ field: "email" })]);
    expect(lines()[0]).toContain("email");
  });

  it("includes expected and found in output", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ expected: "present", found: "missing" })]);
    expect(lines()[0]).toContain("present");
    expect(lines()[0]).toContain("missing");
  });

  it("hides suppressed violations but shows non-suppressed ones", () => {
    const { reporter, lines } = capture();
    reporter.report([
      violation({ suppressed: true, field: "id" }),
      violation({ suppressed: false, field: "email" }),
    ]);
    const violationLines = lines().filter((l) => l.includes("field"));
    expect(violationLines).toHaveLength(1);
    expect(violationLines[0]).toContain("email");
    expect(violationLines[0]).not.toContain('field "id"');
  });
});

describe("ConsoleReporter — summary line", () => {
  it("prints singular 'violation' for exactly 1 violation", () => {
    const { reporter, lines } = capture();
    reporter.report([violation()]);
    const summary = lines().at(-1);
    expect(summary).toContain("1 violation");
    expect(summary).not.toContain("violations");
  });

  it("prints plural 'violations' for more than 1 violation", () => {
    const { reporter, lines } = capture();
    reporter.report([violation(), violation({ field: "name" })]);
    const summary = lines().at(-1);
    expect(summary).toContain("2 violations");
  });

  it("prints a blank line before the summary", () => {
    const { reporter, lines } = capture();
    reporter.report([violation()]);
    const allLines = lines();
    const summaryIndex = allLines.length - 1;
    expect(allLines[summaryIndex - 1]).toBe("");
  });

  it("suppressed-only input produces no summary line", () => {
    const { reporter, lines } = capture();
    reporter.report([violation({ suppressed: true })]);
    expect(lines().some((l) => l.includes("violation"))).toBe(false);
  });

  it("summary count excludes suppressed violations", () => {
    const { reporter, lines } = capture();
    reporter.report([
      violation({ suppressed: true }),
      violation({ suppressed: false, field: "name" }),
      violation({ suppressed: false, field: "email" }),
    ]);
    expect(lines().at(-1)).toContain("2 violations");
  });
});
