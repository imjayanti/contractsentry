import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type {
  FieldShape,
  FieldShapeRecord,
  FunctionShape,
} from "../../domain/FunctionShape.js";

const require = createRequire(import.meta.url);
const pythonGrammar = require("tree-sitter-python") as unknown;

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const DYNAMIC_VALUE_TYPES = new Set([
  "identifier",
  "call",
  "attribute",
  "subscript",
  "await",
  "conditional_expression",
  "binary_operator",
  "f_string",
  "not_operator",
  "comparison_operator",
  "boolean_operator",
]);

export class TreeSitterPythonAnalyzer {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(pythonGrammar);
  }

  analyze(source: string): FunctionShape[] {
    if (!source.trim()) return [];
    const tree = this.parser.parse(source);
    const shapes: FunctionShape[] = [];
    for (const child of tree.rootNode.namedChildren) {
      if (child.type !== "decorated_definition") continue;
      const shape = this.fromDecoratedDef(child);
      if (shape) shapes.push(shape);
    }
    return shapes;
  }

  private fromDecoratedDef(node: SyntaxNode): FunctionShape | null {
    const suppressed = this.isSuppressed(node);
    const decorator = node.children.find((c) => c.type === "decorator");
    const funcDef = node.children.find((c) => c.type === "function_definition");
    if (!decorator || !funcDef) return null;

    const endpointGuess = this.extractEndpoint(decorator);
    if (endpointGuess === null) return null;

    const nameNode = funcDef.childForFieldName("name");
    if (!nameNode) return null;

    const body = funcDef.childForFieldName("body");
    const { returnShape, isDynamic } = body
      ? this.extractReturnShape(body)
      : { returnShape: null, isDynamic: false };

    return {
      name: nameNode.text,
      endpointGuess,
      statusHint: null,
      returnShape,
      paramShape: null,
      line: node.startPosition.row + 1,
      suppressed,
      isDynamic,
    };
  }

  private isSuppressed(node: SyntaxNode): boolean {
    let sib = node.previousNamedSibling;
    while (sib?.type === "comment") {
      if (/\bcsentry-ignore(?![\w-])/.test(sib.text)) return true;
      sib = sib.previousNamedSibling;
    }
    return false;
  }

  private extractEndpoint(decorator: SyntaxNode): string | null {
    const callNode = decorator.children.find((c) => c.type === "call");
    if (!callNode) return null;

    const funcNode = callNode.childForFieldName("function");
    if (funcNode?.type !== "attribute") return null;

    // e.g. router.get → attribute field "get"
    const methodIdentifier = funcNode.childForFieldName("attribute");
    if (!methodIdentifier || methodIdentifier.type !== "identifier")
      return null;
    const methodName = methodIdentifier.text.toLowerCase();

    const argList = callNode.childForFieldName("arguments");
    if (!argList) return null;

    // First named argument must be the path string
    const firstArg = argList.namedChildren[0];
    if (!firstArg || firstArg.type !== "string") return null;
    const pathContent = firstArg.namedChildren.find(
      (c) => c.type === "string_content",
    );
    if (!pathContent) return null;
    const path = pathContent.text;

    let method: string;
    if (methodName === "route") {
      // Flask-style: @app.route("/path", methods=["GET"])
      const extracted = this.extractFlaskMethod(argList);
      if (!extracted) return null;
      method = extracted;
    } else if (HTTP_METHODS.has(methodName)) {
      method = methodName.toUpperCase();
    } else {
      return null;
    }

    return `${method} ${path}`;
  }

  private extractFlaskMethod(argList: SyntaxNode): string | null {
    for (const arg of argList.namedChildren) {
      if (arg.type !== "keyword_argument") continue;
      const name = arg.childForFieldName("name");
      const val = arg.childForFieldName("value");
      if (name?.text !== "methods" || val?.type !== "list") continue;
      const firstEl = val.namedChildren[0];
      if (!firstEl || firstEl.type !== "string") continue;
      const content = firstEl.namedChildren.find(
        (c) => c.type === "string_content",
      );
      if (content) return content.text.toUpperCase();
    }
    return "GET";
  }

  private extractReturnShape(body: SyntaxNode): {
    returnShape: FieldShapeRecord | null;
    isDynamic: boolean;
  } {
    const values = this.collectReturnValues(body);
    let lastStatic: FieldShapeRecord | null = null;
    let hasDynamic = false;

    for (const val of values) {
      if (val.type === "dictionary") {
        lastStatic = this.keysFromDict(val);
      } else if (val.type === "list") {
        const firstEl = val.namedChildren[0];
        if (firstEl?.type === "dictionary") {
          lastStatic = this.keysFromDict(firstEl);
        } else {
          hasDynamic = true;
        }
      } else if (DYNAMIC_VALUE_TYPES.has(val.type)) {
        hasDynamic = true;
      }
    }

    if (lastStatic !== null)
      return { returnShape: lastStatic, isDynamic: false };
    if (hasDynamic) return { returnShape: null, isDynamic: true };
    return { returnShape: null, isDynamic: false };
  }

  private collectReturnValues(node: SyntaxNode): SyntaxNode[] {
    const values: SyntaxNode[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "return_statement") {
        const val = child.namedChildren[0];
        if (val) values.push(val);
      } else if (child.type !== "function_definition") {
        values.push(...this.collectReturnValues(child));
      }
    }
    return values;
  }

  private keysFromDict(dict: SyntaxNode): FieldShapeRecord {
    const result: FieldShapeRecord = {};
    for (const child of dict.namedChildren) {
      if (child.type !== "pair") continue;
      const key = child.namedChildren[0];
      const val = child.namedChildren[1];
      if (!key || key.type !== "string") continue;
      const keyContent = key.namedChildren.find(
        (c) => c.type === "string_content",
      );
      if (!keyContent) continue;
      result[keyContent.text] = val ? this.typeFromValue(val) : null;
    }
    return result;
  }

  private typeFromValue(node: SyntaxNode): FieldShape {
    switch (node.type) {
      case "integer":
        return "integer";
      case "float":
        return "number";
      case "string":
        return node.text;
      case "true":
      case "false":
        return "boolean";
      case "dictionary":
        return this.keysFromDict(node);
      case "list":
        return "array";
      default:
        return null;
    }
  }
}
