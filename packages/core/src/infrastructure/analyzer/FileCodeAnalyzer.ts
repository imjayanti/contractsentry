import { readFile } from "node:fs/promises";
import { AnalysisError } from "../../domain/Errors.js";
import type { FunctionShape } from "../../domain/FunctionShape.js";
import type { ICodeAnalyzer } from "../../domain/ICodeAnalyzer.js";
import { TreeSitterTypeScriptAnalyzer } from "./TreeSitterTypeScriptAnalyzer.js";

export class FileCodeAnalyzer implements ICodeAnalyzer {
  private readonly analyzer = new TreeSitterTypeScriptAnalyzer();

  async analyze(file: string): Promise<Map<string, FunctionShape>> {
    let source: string;
    try {
      source = await readFile(file, "utf-8");
    } catch (err) {
      throw new AnalysisError(
        file,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    const shapes = this.analyzer.analyze(source);
    const shapesByName = new Map<string, FunctionShape>();
    for (const shape of shapes) {
      shapesByName.set(shape.name, shape);
    }
    return shapesByName;
  }
}
