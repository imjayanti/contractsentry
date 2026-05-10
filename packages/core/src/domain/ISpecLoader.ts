import type { OpenAPIV3 } from "openapi-types";

export type OpenAPIDocument = OpenAPIV3.Document;

export interface ISpecLoader {
  load(path: string): Promise<OpenAPIDocument>;
}
