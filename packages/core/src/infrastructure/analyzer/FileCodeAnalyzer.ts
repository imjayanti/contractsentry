import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { AnalysisError } from "../../domain/Errors.js";
import type { FunctionShape } from "../../domain/FunctionShape.js";
import type { ICodeAnalyzer } from "../../domain/ICodeAnalyzer.js";
import { TreeSitterPythonAnalyzer } from "./TreeSitterPythonAnalyzer.js";
import { TreeSitterTypeScriptAnalyzer } from "./TreeSitterTypeScriptAnalyzer.js";

export class FileCodeAnalyzer implements ICodeAnalyzer {
  private readonly tsAnalyzer = new TreeSitterTypeScriptAnalyzer();
  private readonly pyAnalyzer = new TreeSitterPythonAnalyzer();

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

    const isPython = extname(file).toLowerCase() === ".py";
    const shapes = isPython
      ? this.pyAnalyzer.analyze(source)
      : this.tsAnalyzer.analyze(source);

    const shapesByName = new Map<string, FunctionShape>();
    for (const shape of shapes) {
      shapesByName.set(shape.name, shape);
    }
    return shapesByName;
  }
}
