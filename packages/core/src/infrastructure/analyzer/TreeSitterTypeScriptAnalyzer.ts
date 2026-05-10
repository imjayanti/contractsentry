import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { FunctionShape } from "../../domain/FunctionShape.js";

// tree-sitter-typescript ships CJS with no ESM wrapper — use createRequire
const require = createRequire(import.meta.url);
const { typescript } = require("tree-sitter-typescript") as {
  typescript: unknown;
};

const ROUTE_RE = /\/\/\s*@route\s+(\S+\s+\S+)/;

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
      const match = ROUTE_RE.exec(text);
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
    const returnShape = body ? this.shapeFromBlock(body) : null;

    return {
      name: nameNode.text,
      endpointGuess,
      returnShape,
      paramShape: null,
      line: decl.startPosition.row + 1,
      suppressed,
      isDynamic: false,
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
    const returnShape = body ? this.shapeFromArrowBody(body) : null;

    return {
      name: nameNode.text,
      endpointGuess,
      returnShape,
      paramShape: null,
      line: decl.startPosition.row + 1,
      suppressed,
      isDynamic: false,
    };
  }

  private shapeFromBlock(body: SyntaxNode): Record<string, unknown> | null {
    for (const child of body.namedChildren) {
      if (child.type === "return_statement") {
        const returnValue = child.namedChild(0);
        if (returnValue) return this.shapeFromNode(returnValue);
      }
    }
    return null;
  }

  private shapeFromArrowBody(body: SyntaxNode): Record<string, unknown> | null {
    if (body.type === "statement_block") return this.shapeFromBlock(body);

    // Arrow body wrapped in parens: `() => ({ ... })` or `() => ([...])`
    if (body.type === "parenthesized_expression") {
      const inner = body.namedChild(0);
      return inner ? this.shapeFromNode(inner) : null;
    }

    // Bare object or array: `() => ({ ... })` would be parenthesized above;
    // `() => [...]` reaches here as type "array"
    return this.shapeFromNode(body);
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
}
