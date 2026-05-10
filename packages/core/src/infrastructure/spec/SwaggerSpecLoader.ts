import SwaggerParser from "@apidevtools/swagger-parser";
import type { ISpecLoader, OpenAPIDocument } from "../../domain/ISpecLoader.js";
import { SpecLoadError } from "../../domain/errors.js";

export class SwaggerSpecLoader implements ISpecLoader {
  async load(path: string): Promise<OpenAPIDocument> {
    let doc: Record<string, unknown>;

    try {
      doc = (await SwaggerParser.dereference(path)) as Record<string, unknown>;
    } catch (err) {
      throw new SpecLoadError(
        path,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Swagger 2.x uses a `swagger` field instead of `openapi` — not supported
    if ("swagger" in doc) {
      throw new SpecLoadError(
        path,
        new Error(
          "Swagger 2.x is not supported. Please migrate to OpenAPI 3.x.",
        ),
      );
    }

    return doc as OpenAPIDocument;
  }
}
