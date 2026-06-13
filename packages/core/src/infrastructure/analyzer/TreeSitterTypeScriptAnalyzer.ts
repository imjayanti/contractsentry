import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type {
  FieldShape,
  FieldShapeRecord,
  FunctionShape,
} from "../../domain/FunctionShape.js";

// tree-sitter-typescript ships CJS with no ESM wrapper — use createRequire
const require = createRequire(import.meta.url);
const { typescript } = require("tree-sitter-typescript") as {
  typescript: unknown;
};

const ROUTE_ANNOTATION_RE = /\/\/\s*@route\s+(\S+\s+\S+)(?:\s+(\d{3}))?/;

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const RESPONSE_JSON_METHODS = new Set(["json", "send"]);

type ShapeResult = {
  returnShape: FieldShapeRecord | null;
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

// Node types that introduce a new function scope — do not recurse into these
// when searching for return statements belonging to the enclosing function.
const FUNCTION_SCOPE_TYPES = new Set([
  "function_declaration",
  "function",
  "arrow_function",
  "method_definition",
  "generator_function",
  "generator_function_declaration",
]);

// Boundaries for return collection: function scopes + catch_clause (error path,
// excluded so the success return in the try body is preferred).
const RETURN_BOUNDARY_TYPES = new Set([
  ...FUNCTION_SCOPE_TYPES,
  "catch_clause",
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

    shapes.push(...this.extractFrameworkRoutes(tree.rootNode));

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
    const returnValues = this.collectReturnValues(body);

    let lastStatic: ShapeResult | null = null;
    let hasDynamic = false;

    for (const value of returnValues) {
      const result = this.nodeToShapeResult(value);
      if (result.returnShape !== null) {
        lastStatic = result;
      } else if (result.isDynamic) {
        hasDynamic = true;
      }
    }

    if (lastStatic !== null) return lastStatic;
    if (hasDynamic) return { returnShape: null, isDynamic: true };
    return EMPTY_SHAPE;
  }

  private collectReturnValues(node: SyntaxNode): SyntaxNode[] {
    const values: SyntaxNode[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "return_statement") {
        const value = child.namedChild(0);
        if (value) values.push(value);
      } else if (!RETURN_BOUNDARY_TYPES.has(child.type)) {
        values.push(...this.collectReturnValues(child));
      }
    }
    return values;
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

  private shapeFromNode(node: SyntaxNode): FieldShapeRecord | null {
    if (node.type === "object") return this.keysFromObject(node);

    if (node.type === "array") {
      const firstObj = node.namedChildren.find(
        (child) => child.type === "object",
      );
      return firstObj ? this.keysFromObject(firstObj) : null;
    }

    return null;
  }

  private keysFromObject(obj: SyntaxNode): FieldShapeRecord {
    const result: FieldShapeRecord = {};
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

  // ── Framework route auto-detection (Express / Hono / Fastify) ────────────

  private extractFrameworkRoutes(root: SyntaxNode): FunctionShape[] {
    const results: FunctionShape[] = [];
    this.walkForRoutes(root, results);
    return results;
  }

  private walkForRoutes(node: SyntaxNode, results: FunctionShape[]): void {
    if (node.type === "call_expression") {
      const shape = this.tryExtractRouteCall(node);
      if (shape) results.push(shape);
    }
    for (const child of node.namedChildren) {
      this.walkForRoutes(child, results);
    }
  }

  private tryExtractRouteCall(node: SyntaxNode): FunctionShape | null {
    const fn = node.childForFieldName("function");
    if (fn?.type !== "member_expression") return null;

    const propertyNode = fn.childForFieldName("property");
    if (!propertyNode) return null;

    const method = propertyNode.text.toLowerCase();
    if (!HTTP_METHODS.has(method)) return null;

    const argsNode = node.childForFieldName("arguments");
    if (!argsNode) return null;

    const argChildren = argsNode.namedChildren;
    const objectNode = fn.childForFieldName("object");

    // Detect router.route('/path').METHOD(handler) chaining (including deeper
    // chains like .route().get().post())
    const chained =
      objectNode?.type === "call_expression"
        ? this.resolveRouteChain(objectNode)
        : null;

    let rawPath: string;
    let routerName: string;

    if (chained) {
      if (argChildren.length < 1) return null;
      rawPath = chained.rawPath;
      routerName = chained.routerName;
    } else {
      // If the object is itself a call (e.g. db.query(...).get(...)) and no
      // .route() ancestor was found, this isn't a framework route.
      if (objectNode?.type === "call_expression") return null;
      if (argChildren.length < 2) return null;
      const firstArg = argChildren[0];
      if (firstArg.type !== "string") return null;
      rawPath = firstArg.text.slice(1, -1);
      routerName = objectNode?.text ?? "router";
    }

    // Strip quotes; convert Express :param to OpenAPI {param}
    const path = rawPath.replace(/:([^/{}]+)/g, "{$1}");

    // Last arg must be an inline function (arrow or function expression)
    const lastArg = argChildren[argChildren.length - 1];
    if (lastArg.type !== "arrow_function" && lastArg.type !== "function") {
      return null;
    }

    const handlerBody = lastArg.childForFieldName("body");
    const { returnShape, isDynamic } = handlerBody
      ? this.extractHandlerShape(handlerBody)
      : EMPTY_SHAPE;

    return {
      name: `${routerName}.${method}("${rawPath}")`,
      endpointGuess: `${method.toUpperCase()} ${path}`,
      statusHint: null,
      returnShape,
      paramShape: null,
      line: node.startPosition.row + 1,
      suppressed: false,
      isDynamic,
    };
  }

  // Walks a call_expression chain looking for a .route('/path') ancestor.
  // Returns the path and router name when found, null otherwise.
  // Handles arbitrary depth: router.route('/p').get(h).post(h) etc.
  private resolveRouteChain(
    node: SyntaxNode,
  ): { rawPath: string; routerName: string } | null {
    let current: SyntaxNode = node;
    while (current.type === "call_expression") {
      const fn = current.childForFieldName("function");
      if (fn?.type !== "member_expression") return null;
      const prop = fn.childForFieldName("property");
      if (!prop) return null;
      if (prop.text === "route") {
        const args = current.childForFieldName("arguments");
        const pathNode = args?.namedChildren[0];
        if (pathNode?.type !== "string") return null;
        return {
          rawPath: pathNode.text.slice(1, -1),
          routerName: fn.childForFieldName("object")?.text ?? "router",
        };
      }
      const obj = fn.childForFieldName("object");
      if (!obj) return null;
      current = obj;
    }
    return null;
  }

  private extractHandlerShape(body: SyntaxNode): ShapeResult {
    // Expression body: `async (c) => c.json({...})` — body IS the call_expression
    if (body.type !== "statement_block") {
      const jsonResult = this.tryExtractJsonCallResult(body);
      if (jsonResult !== null) return jsonResult;
      return this.shapeFromArrowBody(body);
    }

    // Block body: find res.json({...}) / c.json({...}) / reply.send({...}) etc.
    const jsonResult = this.collectJsonCallResult(body);
    if (jsonResult !== null) return jsonResult;

    return this.shapeFromBlock(body);
  }

  /**
   * If `node` is a response json call, return its ShapeResult.
   * Returns { returnShape, isDynamic: false } for object literal args,
   * { returnShape: null, isDynamic: true } for dynamic args, or null if not a json call.
   */
  private tryExtractJsonCallResult(node: SyntaxNode): ShapeResult | null {
    if (node.type !== "call_expression") return null;

    const fn = node.childForFieldName("function");
    if (fn?.type !== "member_expression") return null;

    const prop = fn.childForFieldName("property");
    if (!prop || !RESPONSE_JSON_METHODS.has(prop.text)) return null;

    const callArgs = node.childForFieldName("arguments");
    const firstCallArg = callArgs?.namedChild(0);
    if (!firstCallArg) return { returnShape: null, isDynamic: false };

    if (firstCallArg.type === "object") {
      return {
        returnShape: this.keysFromObject(firstCallArg),
        isDynamic: false,
      };
    }

    return {
      returnShape: null,
      isDynamic: DYNAMIC_NODE_TYPES.has(firstCallArg.type),
    };
  }

  private collectJsonCallResult(node: SyntaxNode): ShapeResult | null {
    let lastResult: ShapeResult | null = null;
    for (const child of node.namedChildren) {
      if (child.type === "call_expression") {
        const result = this.tryExtractJsonCallResult(child);
        if (result !== null) {
          lastResult = result;
          continue;
        }
      }
      if (!FUNCTION_SCOPE_TYPES.has(child.type)) {
        const nested = this.collectJsonCallResult(child);
        if (nested !== null) lastResult = nested;
      }
    }
    return lastResult;
  }
}
