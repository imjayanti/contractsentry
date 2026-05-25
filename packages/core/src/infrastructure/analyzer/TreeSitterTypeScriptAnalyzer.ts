import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { FieldShape, FunctionShape } from "../../domain/FunctionShape.js";

// tree-sitter-typescript ships CJS with no ESM wrapper — use createRequire
const require = createRequire(import.meta.url);
const { typescript } = require("tree-sitter-typescript") as {
  typescript: unknown;
};

const ROUTE_ANNOTATION_RE = /\/\/\s*@route\s+(\S+\s+\S+)(?:\s+(\d{3}))?/;

type ShapeResult = {
  returnShape: Record<string, FieldShape> | null;
  isDynamic: boolean;
};

const EMPTY_SHAPE: ShapeResult = { returnShape: null, isDynamic: false };

const DYNAMIC_NODE_TYPES = new Set([
  "identifier",
  "call_expression",
  "member_expression",
  "await_expression",
  "ternary_expression",
  "binary_expression",
  "as_expression",
  "new_expression",
  "template_string",
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
    const { endpointGuess, statusHint, suppressed } =
      this.readLeadingComments(node);
    const decl = node.childForFieldName("declaration");
    if (!decl) return null;

    if (decl.type === "function_declaration") {
      return this.fromFunctionDecl(decl, endpointGuess, statusHint, suppressed);
    }

    if (decl.type === "lexical_declaration") {
      return this.fromLexicalDecl(decl, endpointGuess, statusHint, suppressed);
    }

    return null;
  }

  private readLeadingComments(node: SyntaxNode): {
    endpointGuess: string | null;
    statusHint: number | null;
    suppressed: boolean;
  } {
    let endpointGuess: string | null = null;
    let statusHint: number | null = null;
    let suppressed = false;

    let sib = node.previousNamedSibling;
    while (sib?.type === "comment") {
      const text = sib.text;
      const match = ROUTE_ANNOTATION_RE.exec(text);
      if (match) {
        endpointGuess = match[1].trim();
        statusHint = match[2] ? Number.parseInt(match[2], 10) : null;
      }
      if (/\bcsentry-ignore(?![\w-])/.test(text)) suppressed = true;
      sib = sib.previousNamedSibling;
    }

    return { endpointGuess, statusHint, suppressed };
  }

  private fromFunctionDecl(
    decl: SyntaxNode,
    endpointGuess: string | null,
    statusHint: number | null,
    suppressed: boolean,
  ): FunctionShape | null {
    const nameNode = decl.childForFieldName("name");
    if (!nameNode) return null;

    const body = decl.childForFieldName("body");
    const { returnShape, isDynamic } = body
      ? this.shapeFromBlock(body)
      : EMPTY_SHAPE;

    const paramShape = this.paramShapeFromParams(
      decl.childForFieldName("parameters"),
    );

    return {
      name: nameNode.text,
      endpointGuess,
      statusHint,
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
    statusHint: number | null,
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
      : EMPTY_SHAPE;

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
      statusHint,
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

  private shapeFromNode(node: SyntaxNode): Record<string, FieldShape> | null {
    if (node.type === "object") return this.keysFromObject(node);

    if (node.type === "array") {
      const firstObj = node.namedChildren.find((c) => c.type === "object");
      return firstObj ? this.keysFromObject(firstObj) : null;
    }

    return null;
  }

  private keysFromObject(obj: SyntaxNode): Record<string, FieldShape> {
    const result: Record<string, FieldShape> = {};
    for (const child of obj.namedChildren) {
      if (child.type === "pair") {
        const key = child.childForFieldName("key");
        const value = child.childForFieldName("value");
        if (key && key.type !== "computed_property_name")
          result[key.text] = value ? this.typeFromValueNode(value) : null;
      } else if (child.type === "shorthand_property_identifier") {
        result[child.text] = null;
      }
      // spread_element is intentionally skipped — static shape is unknowable
    }
    return result;
  }

  private typeFromValueNode(node: SyntaxNode): FieldShape {
    switch (node.type) {
      case "number":
        return Number.isInteger(Number(node.text)) ? "integer" : "number";
      case "unary_expression": {
        // handles negative numeric literals: -1, -3.14
        const num = Number(node.text);
        if (!Number.isNaN(num)) {
          return Number.isInteger(num) ? "integer" : "number";
        }
        return null;
      }
      case "string":
        return node.text;
      case "true":
      case "false":
        return "boolean";
      case "object":
        return this.keysFromObject(node);
      case "array":
        return "array";
      default:
        return null;
    }
  }

  private paramShapeFromParams(
    params: SyntaxNode | null,
  ): Record<string, string | null> | null {
    if (!params || params.type !== "formal_parameters") return null;
    const result: Record<string, string | null> = {};
    for (const child of params.namedChildren) {
      if (
        child.type === "required_parameter" ||
        child.type === "optional_parameter"
      ) {
        const pattern = child.childForFieldName("pattern");
        if (pattern?.type === "identifier") {
          const typeAnnotation = child.childForFieldName("type");
          result[pattern.text] = typeAnnotation
            ? this.typeFromTypeAnnotation(typeAnnotation)
            : null;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private typeFromTypeAnnotation(annotation: SyntaxNode): string | null {
    const typeNode = annotation.namedChild(0);
    if (!typeNode) return null;
    switch (typeNode.type) {
      case "predefined_type":
        switch (typeNode.text) {
          case "string":
            return "string";
          case "number":
            return "number";
          case "boolean":
            return "boolean";
          default:
            return null;
        }
      case "array_type":
        return "array";
      case "generic_type":
        return typeNode.text.startsWith("Array") ? "array" : null;
      default:
        return null;
    }
  }
}
