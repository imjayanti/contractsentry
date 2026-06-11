import { readFile } from "node:fs/promises";
import { AnalysisError } from "../../domain/Errors.js";
import type { Violation } from "../../domain/Violation.js";
import {
  AiBridgeAnalyzer,
  type AiViolation,
} from "../analyzer/AiBridgeAnalyzer.js";
import { FileCodeAnalyzer } from "../analyzer/FileCodeAnalyzer.js";
import { OpenApiSpecLoader } from "../spec/OpenApiSpecLoader.js";
import { SchemaExtractor } from "../spec/SchemaExtractor.js";
import { ContractValidator } from "../validator/ContractValidator.js";

export interface ScanInput {
  specPath: string;
  filePaths: string[];
  useAi?: boolean;
}

export class ScanOrchestrator {
  private readonly specLoader = new OpenApiSpecLoader();
  private readonly schemaExtractor = new SchemaExtractor();
  private readonly codeAnalyzer = new FileCodeAnalyzer();
  private readonly validator = new ContractValidator();

  constructor(private readonly aiBridge = new AiBridgeAnalyzer()) {}

  async scan(input: ScanInput): Promise<Violation[]> {
    const doc = await this.specLoader.load(input.specPath);
    const schemas = this.schemaExtractor.extract(doc);
    const perFileViolations = await Promise.all(
      input.filePaths.map((file) =>
        this.analyzeFile(file, schemas, input.useAi ?? false),
      ),
    );
    return perFileViolations.flat();
  }

  private async analyzeFile(
    file: string,
    schemas: Map<string, Record<string, unknown>>,
    useAi: boolean,
  ): Promise<Violation[]> {
    let source: string;
    try {
      source = await readFile(file, "utf-8");
    } catch (err) {
      throw new AnalysisError(
        file,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    const shapes = this.codeAnalyzer.analyzeSource(source, file);
    const violations: Violation[] = [];
    const aiProcessed = new Set<string>();

    for (const shape of shapes.values()) {
      if (!shape.endpointGuess) continue;

      if (shape.isDynamic) {
        violations.push({
          file,
          line: shape.line,
          endpoint: shape.endpointGuess,
          field: "(return value)",
          expected: "static object literal",
          found: "dynamic expression",
          severity: "warn",
          suppressed: shape.suppressed,
        });
      }

      for (const schema of this.successSchemasFor(
        shape.endpointGuess,
        shape.statusHint,
        schemas,
      )) {
        violations.push(...this.validator.validate(shape, schema, file));
      }

      const requestSchema = this.requestSchemaFor(shape.endpointGuess, schemas);
      if (requestSchema) {
        violations.push(
          ...this.validator.validateRequest(shape, requestSchema, file),
        );
      }

      if (useAi && !shape.suppressed && !aiProcessed.has(shape.endpointGuess)) {
        aiProcessed.add(shape.endpointGuess);
        const aiViolations = await this.runAi(
          source,
          shape.endpointGuess,
          schemas,
        );
        violations.push(
          ...this.mergeAi(
            aiViolations,
            violations,
            shape.endpointGuess,
            file,
            shape.line,
          ),
        );
      }
    }
    return violations;
  }

  private async runAi(
    source: string,
    endpoint: string,
    schemas: Map<string, Record<string, unknown>>,
  ): Promise<AiViolation[]> {
    const schema = this.primarySuccessSchemaFor(endpoint, schemas);
    if (!schema) return [];
    return this.aiBridge.analyzeEndpoint(endpoint, schema, source);
  }

  private primarySuccessSchemaFor(
    endpointGuess: string,
    schemas: Map<string, Record<string, unknown>>,
  ): Record<string, unknown> | null {
    const prefix = `${endpointGuess}:`;
    let lowestCode = Number.POSITIVE_INFINITY;
    let lowestSchema: Record<string, unknown> | null = null;
    for (const [key, schema] of schemas) {
      if (!key.startsWith(prefix)) continue;
      const code = key.slice(prefix.length);
      if (!code.startsWith("2")) continue;
      const num = Number(code);
      if (!Number.isNaN(num) && num < lowestCode) {
        lowestCode = num;
        lowestSchema = schema;
      }
    }
    return lowestSchema;
  }

  private mergeAi(
    aiViolations: AiViolation[],
    existing: Violation[],
    endpoint: string,
    file: string,
    line: number,
  ): Violation[] {
    const seen = new Set(existing.map((v) => `${v.endpoint}::${v.field}`));
    const added: Violation[] = [];
    for (const av of aiViolations) {
      const key = `${endpoint}::${av.field}`;
      if (seen.has(key)) continue;
      added.push({
        file,
        line,
        endpoint,
        field: av.field,
        expected: av.expected,
        found: av.found,
        severity: "error",
        suppressed: false,
        explanation: av.explanation,
      });
    }
    return added;
  }

  private successSchemasFor(
    endpointGuess: string,
    statusHint: number | null,
    schemas: Map<string, Record<string, unknown>>,
  ): Record<string, unknown>[] {
    const prefix = `${endpointGuess}:`;
    const result: Record<string, unknown>[] = [];
    for (const [key, schema] of schemas) {
      if (!key.startsWith(prefix)) continue;
      const code = key.slice(prefix.length);
      if (
        statusHint !== null ? code === String(statusHint) : code.startsWith("2")
      ) {
        result.push(schema);
      }
    }
    return result;
  }

  private requestSchemaFor(
    endpointGuess: string,
    schemas: Map<string, Record<string, unknown>>,
  ): Record<string, unknown> | null {
    return schemas.get(`${endpointGuess}:request`) ?? null;
  }
}
