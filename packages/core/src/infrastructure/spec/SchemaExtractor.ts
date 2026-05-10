import type { OpenAPIV3 } from "openapi-types";
import type { OpenAPIDocument } from "../../domain/ISpecLoader.js";

type SchemaObject = Record<string, unknown>;
type SchemaMap = Map<string, SchemaObject>;

const HTTP_METHODS = [
  "get",
  "head",
  "post",
  "put",
  "patch",
  "delete",
] as const satisfies ReadonlyArray<keyof OpenAPIV3.PathItemObject>;

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
    return schema as SchemaObject;
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
    return schema as SchemaObject;
  }
}
