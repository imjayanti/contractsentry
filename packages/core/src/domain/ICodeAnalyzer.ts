import type { FunctionShape } from "./FunctionShape.js";

export interface ICodeAnalyzer {
  analyze(file: string): Promise<Map<string, FunctionShape>>;
}
