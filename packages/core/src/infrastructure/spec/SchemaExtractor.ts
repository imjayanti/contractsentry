import type { OpenAPIV3 } from "openapi-types";
import type { OpenAPIDocument } from "../../domain/ISpecLoader.js";

type SchemaObject = Record<string, unknown>;
type SchemaMap = Map<string, SchemaObject>;

// Template literal over the enum resolves to the string union "get" | "put" | ...
type HttpMethod = `${OpenAPIV3.HttpMethods}`;

const HTTP_METHODS = [
  "get",
  "head",
  "post",
  "put",
  "patch",
  "delete",
] as const satisfies ReadonlyArray<HttpMethod>;

export class SchemaExtractor {
  extract(doc: OpenAPIDocument): SchemaMap {
    const schemas: SchemaMap = new Map();

    for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
      if (!pathItem) continue;
      this.extractFromPathItem(path, pathItem, schemas);
    }

    return schemas;
  }

  private extractFromPathItem(
    path: string,
    pathItem: OpenAPIV3.PathItemObject,
    schemas: SchemaMap,
  ): void {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const upperMethod = method.toUpperCase();

      for (const [statusCode, response] of Object.entries(
        operation.responses ?? {},
      )) {
        // defensive guard: dereference() resolves $refs, but guard against edge cases
        if ("$ref" in response) continue;
        const schema = this.extractResponseSchema(response);
        if (schema) schemas.set(`${upperMethod} ${path}:${statusCode}`, schema);
      }

      const requestSchema = this.extractRequestSchema(operation.requestBody);
      if (requestSchema)
        schemas.set(`${upperMethod} ${path}:request`, requestSchema);
    }
  }

  private extractResponseSchema(
    response: OpenAPIV3.ResponseObject,
  ): SchemaObject | null {
    const schema = response.content?.["application/json"]?.schema;
    if (!schema || "$ref" in schema) return null;
    const resolved = this.resolveComposition(schema as SchemaObject);
    if (resolved.type === "array") return this.unwrapArrayItems(resolved);
    return resolved;
  }

  private unwrapArrayItems(schema: SchemaObject): SchemaObject | null {
    const { items } = schema;
    if (typeof items !== "object" || items === null) return null;
    const itemsObj = items as SchemaObject;
    if ("$ref" in itemsObj) return null;
    // Only validate object-typed items; primitive arrays (string[], number[]) have no field shapes
    if (itemsObj.type !== "object") return null;
    return itemsObj;
  }

  private extractRequestSchema(
    requestBody:
      | OpenAPIV3.RequestBodyObject
      | OpenAPIV3.ReferenceObject
      | undefined,
  ): SchemaObject | null {
    if (!requestBody || "$ref" in requestBody) return null;
    const schema = requestBody.content["application/json"]?.schema;
    if (!schema || "$ref" in schema) return null;
    return this.resolveComposition(schema as SchemaObject);
  }

  private resolveComposition(schema: SchemaObject): SchemaObject {
    const flat = this.flattenKeywords(schema);
    if (typeof flat.properties !== "object" || flat.properties === null)
      return flat;

    const resolvedProps: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(
      flat.properties as Record<string, unknown>,
    )) {
      resolvedProps[key] =
        typeof propSchema === "object" &&
        propSchema !== null &&
        !("$ref" in propSchema)
          ? this.resolveComposition(propSchema as SchemaObject)
          : propSchema;
    }
    return { ...flat, properties: resolvedProps };
  }

  private flattenKeywords(schema: SchemaObject): SchemaObject {
    if (Array.isArray(schema.allOf)) {
      const { allOf, ...rest } = schema;
      const base = this.flattenKeywords(rest as SchemaObject);
      const subschemas = (allOf as SchemaObject[]).map((s) =>
        this.flattenKeywords(s),
      );
      return this.mergeSchemas([base, ...subschemas]);
    }

    if (Array.isArray(schema.oneOf)) {
      return this.resolveVariants(schema.oneOf as SchemaObject[]);
    }

    if (Array.isArray(schema.anyOf)) {
      return this.resolveVariants(schema.anyOf as SchemaObject[]);
    }

    return schema;
  }

  private resolveVariants(variants: SchemaObject[]): SchemaObject {
    const candidates = this.filterNullVariants(variants).map((s) =>
      this.flattenKeywords(s),
    );
    if (candidates.length === 0) return {};
    if (candidates.length === 1) return candidates[0];
    return this.intersectSchemas(candidates);
  }

  private mergeSchemas(schemas: SchemaObject[]): SchemaObject {
    const required = new Set<string>();
    const properties: Record<string, unknown> = {};
    let type: string | undefined;

    for (const schema of schemas) {
      if (Array.isArray(schema.required)) {
        for (const f of schema.required) {
          if (typeof f === "string") required.add(f);
        }
      }
      if (typeof schema.properties === "object" && schema.properties !== null) {
        Object.assign(properties, schema.properties as Record<string, unknown>);
      }
      if (typeof schema.type === "string" && type === undefined) {
        type = schema.type;
      }
    }

    const result: SchemaObject = {};
    if (type !== undefined) result.type = type;
    if (required.size > 0) result.required = [...required];
    if (Object.keys(properties).length > 0) result.properties = properties;
    return result;
  }

  private intersectSchemas(schemas: SchemaObject[]): SchemaObject {
    const requiredSets = schemas.map(
      (s) =>
        new Set(
          Array.isArray(s.required)
            ? s.required.filter((f): f is string => typeof f === "string")
            : [],
        ),
    );
    const firstSet = requiredSets[0] ?? new Set<string>();
    const requiredInAll = [...firstSet].filter((field) =>
      requiredSets.every((set) => set.has(field)),
    );

    const properties: Record<string, unknown> = {};
    for (const schema of schemas) {
      if (typeof schema.properties === "object" && schema.properties !== null) {
        Object.assign(properties, schema.properties as Record<string, unknown>);
      }
    }

    // Preserve type only when all variants agree (e.g. all "object")
    const types = schemas
      .map((s) => (typeof s.type === "string" ? s.type : null))
      .filter((t): t is string => t !== null);
    const sharedType =
      types.length === schemas.length && new Set(types).size === 1
        ? types[0]
        : undefined;

    const result: SchemaObject = {};
    if (sharedType !== undefined) result.type = sharedType;
    if (requiredInAll.length > 0) result.required = requiredInAll;
    if (Object.keys(properties).length > 0) result.properties = properties;
    return result;
  }

  private filterNullVariants(schemas: SchemaObject[]): SchemaObject[] {
    return schemas.filter(
      (s) =>
        !(
          s.type === "null" &&
          s.properties === undefined &&
          s.required === undefined
        ),
    );
  }
}
