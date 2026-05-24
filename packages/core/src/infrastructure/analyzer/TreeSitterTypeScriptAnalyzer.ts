import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { FunctionShape } from "../../domain/FunctionShape.js";

// tree-sitter-typescript ships CJS with no ESM wrapper — use createRequire
const require = createRequire(import.meta.url);
const { typescript } = require("tree-sitter-typescript") as {
  typescript: unknown;
};

const ROUTE_ANNOTATION_RE = /\/\/\s*@route\s+(\S+\s+\S+)/;

type ShapeResult = {
  returnShape: Record<string, unknown> | null;
  isDynamic: boolean;
};

const EMPTY_SHAPE: ShapeResult = { returnShape: null, isDynamic: false };

const DYNAMIC_NODE_TYPES = new Set([
  "identifier",
  "call_expression",
  "member_expression",
  "await_expression",
  "ternary_expression",
  "as_expression",
  "new_expression",
]);

export class TreeSitterTypeScriptAnalyzer {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(typescript);
  }

  analyze(source: string): FunctionShape[] {
    if (!source.trim()) return [];

    const tree = this.parser.parse(source);
    const shapes: FunctionShape[] = [];

    for (const child of tree.rootNode.children) {
      if (child.type !== "export_statement") continue;
      const shape = this.fromExport(child);
      if (shape) shapes.push(shape);
    }

    return shapes;
  }

  private fromExport(node: SyntaxNode): FunctionShape | null {
    const { endpointGuess, suppressed } = this.readLeadingComments(node);
    const decl = node.childForFieldName("declaration");
    if (!decl) return null;

    if (decl.type === "function_declaration") {
      return this.fromFunctionDecl(decl, endpointGuess, suppressed);
    }

    if (decl.type === "lexical_declaration") {
      return this.fromLexicalDecl(decl, endpointGuess, suppressed);
    }

    return null;
  }

  private readLeadingComments(node: SyntaxNode): {
    endpointGuess: string | null;
    suppressed: boolean;
  } {
    let endpointGuess: string | null = null;
    let suppressed = false;

    let sib = node.previousNamedSibling;
    while (sib?.type === "comment") {
      const text = sib.text;
      const match = ROUTE_ANNOTATION_RE.exec(text);
      if (match) endpointGuess = match[1].trim();
      if (text.includes("csentry-ignore")) suppressed = true;
      sib = sib.previousNamedSibling;
    }

    return { endpointGuess, suppressed };
  }

  private fromFunctionDecl(
    decl: SyntaxNode,
    endpointGuess: string | null,
    suppressed: boolean,
  ): FunctionShape | null {
    const nameNode = decl.childForFieldName("name");
    if (!nameNode) return null;

    const body = decl.childForFieldName("body");
    const { returnShape, isDynamic } = body
      ? this.shapeFromBlock(body)
      : { returnShape: null, isDynamic: false };

    const paramShape = this.paramShapeFromParams(
      decl.childForFieldName("parameters"),
    );

    return {
      name: nameNode.text,
      endpointGuess,
      returnShape,
      paramShape,
      line: decl.startPosition.row + 1,
      suppressed,
      isDynamic,
    };
  }

  private fromLexicalDecl(
    decl: SyntaxNode,
    endpointGuess: string | null,
    suppressed: boolean,
  ): FunctionShape | null {
    const varDeclarator = decl.namedChild(0);
    if (!varDeclarator || varDeclarator.type !== "variable_declarator") {
      return null;
    }

    const nameNode = varDeclarator.childForFieldName("name");
    if (!nameNode) return null;

    const value = varDeclarator.childForFieldName("value");
    if (!value || value.type !== "arrow_function") return null;

    const body = value.childForFieldName("body");
    const { returnShape, isDynamic } = body
      ? this.shapeFromArrowBody(body)
      : { returnShape: null, isDynamic: false };

    // arrow_function exposes either "parameters" (formal_parameters) or
    // "parameter" (single identifier, no parens: `x => ...`)
    let paramShape = this.paramShapeFromParams(
      value.childForFieldName("parameters"),
    );
    if (paramShape === null) {
      const singleParam = value.childForFieldName("parameter");
      if (singleParam?.type === "identifier") {
        paramShape = { [singleParam.text]: null };
      }
    }

    return {
      name: nameNode.text,
      endpointGuess,
      returnShape,
      paramShape,
      line: decl.startPosition.row + 1,
      suppressed,
      isDynamic,
    };
  }

  private nodeToShapeResult(node: SyntaxNode): ShapeResult {
    const returnShape = this.shapeFromNode(node);
    return returnShape !== null
      ? { returnShape, isDynamic: false }
      : { returnShape: null, isDynamic: DYNAMIC_NODE_TYPES.has(node.type) };
  }

  private shapeFromBlock(body: SyntaxNode): ShapeResult {
    for (const child of body.namedChildren) {
      if (child.type === "return_statement") {
        const returnValue = child.namedChild(0);
        return returnValue ? this.nodeToShapeResult(returnValue) : EMPTY_SHAPE;
      }
    }
    return EMPTY_SHAPE;
  }

  private shapeFromArrowBody(body: SyntaxNode): ShapeResult {
    if (body.type === "statement_block") return this.shapeFromBlock(body);

    // `() => ({ ... })` and `() => ([...])` produce a parenthesized_expression node
    if (body.type === "parenthesized_expression") {
      const inner = body.namedChild(0);
      return inner ? this.nodeToShapeResult(inner) : EMPTY_SHAPE;
    }

    return this.nodeToShapeResult(body);
  }

  private shapeFromNode(node: SyntaxNode): Record<string, unknown> | null {
    if (node.type === "object") return this.keysFromObject(node);

    if (node.type === "array") {
      const firstObj = node.namedChildren.find((c) => c.type === "object");
      return firstObj ? this.keysFromObject(firstObj) : null;
    }

    return null;
  }

  private keysFromObject(obj: SyntaxNode): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const child of obj.namedChildren) {
      if (child.type === "pair") {
        const key = child.childForFieldName("key");
        if (key) result[key.text] = null;
      } else if (child.type === "shorthand_property_identifier") {
        result[child.text] = null;
      }
      // spread_element is intentionally skipped — static shape is unknowable
    }
    return result;
  }

  private paramShapeFromParams(
    params: SyntaxNode | null,
  ): Record<string, unknown> | null {
    if (!params || params.type !== "formal_parameters") return null;
    const result: Record<string, unknown> = {};
    for (const child of params.namedChildren) {
      if (
        child.type === "required_parameter" ||
        child.type === "optional_parameter"
      ) {
        const pattern = child.childForFieldName("pattern");
        if (pattern?.type === "identifier") {
          result[pattern.text] = null;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }
}
