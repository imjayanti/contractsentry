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
    const filePrefix = this.extractFileLevelPrefix(source);
    const routerPrefixes = this.collectRouterPrefixes(tree.rootNode);
    const shapes: FunctionShape[] = [];
    for (const child of tree.rootNode.namedChildren) {
      if (child.type !== "decorated_definition") continue;
      const shape = this.fromDecoratedDef(child, filePrefix, routerPrefixes);
      if (shape) shapes.push(shape);
    }
    return shapes;
  }

  // Scans source lines for `# csentry-prefix /path` — used when a router is
  // mounted via include_router in another file and the prefix can't be inferred.
  private extractFileLevelPrefix(source: string): string {
    for (const line of source.split("\n")) {
      const match = /^#\s*csentry-prefix\s+(\/\S*)/.exec(line.trim());
      if (match) return match[1];
    }
    return "";
  }

  // Collects `varName = APIRouter(prefix="/path")` assignments (including
  // type-annotated form `varName: APIRouter = APIRouter(prefix="/path")`)
  // so we can prepend the prefix to every route decorated with that router variable.
  private collectRouterPrefixes(root: SyntaxNode): Map<string, string> {
    const prefixes = new Map<string, string>();
    for (const node of root.namedChildren) {
      // Both plain assignments and annotated assignments (`x: T = ...`) live
      // directly under expression_statement in tree-sitter-python.
      if (node.type !== "expression_statement") continue;
      const assign = node.namedChildren[0];
      if (!assign) continue;
      const isPlain = assign.type === "assignment";
      const isAnnotated = assign.type === "annotated_assignment";
      if (!isPlain && !isAnnotated) continue;
      const left = assign.childForFieldName("left");
      const right = assign.childForFieldName("right");
      if (
        !left ||
        !right ||
        left.type !== "identifier" ||
        right.type !== "call"
      )
        continue;
      const fn = right.childForFieldName("function");
      if (fn?.type !== "identifier" || fn.text !== "APIRouter") continue;
      const args = right.childForFieldName("arguments");
      if (!args) continue;
      const prefix = this.extractPrefixKwarg(args);
      if (prefix !== null) prefixes.set(left.text, prefix);
    }
    return prefixes;
  }

  private extractPrefixKwarg(argList: SyntaxNode): string | null {
    for (const arg of argList.namedChildren) {
      if (arg.type !== "keyword_argument") continue;
      const name = arg.childForFieldName("name");
      const val = arg.childForFieldName("value");
      if (name?.text !== "prefix" || val?.type !== "string") continue;
      const content = val.namedChildren.find(
        (c) => c.type === "string_content",
      );
      return content?.text ?? null;
    }
    return null;
  }

  private fromDecoratedDef(
    node: SyntaxNode,
    filePrefix: string,
    routerPrefixes: Map<string, string>,
  ): FunctionShape | null {
    const suppressed = this.isSuppressed(node);
    const decorator = node.children.find((child) => child.type === "decorator");
    const funcDef = node.children.find(
      (child) => child.type === "function_definition",
    );
    if (!decorator || !funcDef) return null;

    const endpointGuess = this.extractEndpoint(
      decorator,
      filePrefix,
      routerPrefixes,
    );
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
      paramShape: null, // request-body introspection not yet implemented for Python
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

  private extractEndpoint(
    decorator: SyntaxNode,
    filePrefix: string,
    routerPrefixes: Map<string, string>,
  ): string | null {
    const callNode = decorator.children.find((child) => child.type === "call");
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
    const localPath = pathContent.text;

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

    // Prepend prefixes: file-level prefix (from # csentry-prefix or include_router)
    // followed by the router variable's own prefix (from APIRouter(prefix=...)).
    const routerObj = funcNode.childForFieldName("object");
    const routerPrefix =
      routerObj?.type === "identifier"
        ? (routerPrefixes.get(routerObj.text) ?? "")
        : "";
    // Strip trailing slashes from each prefix segment to avoid double slashes
    // when the prefix ends with "/" and the local path starts with "/".
    const path =
      filePrefix.replace(/\/$/, "") +
      routerPrefix.replace(/\/$/, "") +
      localPath;

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
