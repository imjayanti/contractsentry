export type Severity = "error" | "warn";

export interface Violation {
  file: string;
  line: number;
  endpoint: string;
  field: string;
  expected: string;
  found: string;
  severity: Severity;
  suppressed?: boolean;
}
