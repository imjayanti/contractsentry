import type { Violation } from "../../domain/Violation.js";
import { FileCodeAnalyzer } from "../analyzer/FileCodeAnalyzer.js";
import { OpenApiSpecLoader } from "../spec/OpenApiSpecLoader.js";
import { SchemaExtractor } from "../spec/SchemaExtractor.js";
import { ContractValidator } from "../validator/ContractValidator.js";

export interface ScanInput {
  specPath: string;
  filePaths: string[];
}

export class ScanOrchestrator {
  private readonly specLoader = new OpenApiSpecLoader();
  private readonly schemaExtractor = new SchemaExtractor();
  private readonly codeAnalyzer = new FileCodeAnalyzer();
  private readonly validator = new ContractValidator();

  async scan(input: ScanInput): Promise<Violation[]> {
    const doc = await this.specLoader.load(input.specPath);
    const schemas = this.schemaExtractor.extract(doc);
    const perFileViolations = await Promise.all(
      input.filePaths.map((file) => this.analyzeFile(file, schemas)),
    );
    return perFileViolations.flat();
  }

  private async analyzeFile(
    file: string,
    schemas: Map<string, Record<string, unknown>>,
  ): Promise<Violation[]> {
    const shapes = await this.codeAnalyzer.analyze(file);
    const violations: Violation[] = [];
    for (const shape of shapes.values()) {
      if (!shape.endpointGuess) continue;
      for (const schema of this.successSchemasFor(
        shape.endpointGuess,
        schemas,
      )) {
        violations.push(...this.validator.validate(shape, schema, file));
      }
    }
    return violations;
  }

  private successSchemasFor(
    endpointGuess: string,
    schemas: Map<string, Record<string, unknown>>,
  ): Record<string, unknown>[] {
    const prefix = `${endpointGuess}:`;
    const result: Record<string, unknown>[] = [];
    for (const [key, schema] of schemas) {
      if (key.startsWith(prefix) && key.slice(prefix.length).startsWith("2")) {
        result.push(schema);
      }
    }
    return result;
  }
}
