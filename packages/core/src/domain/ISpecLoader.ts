export type OpenAPIDocument = Record<string, unknown>;

export interface ISpecLoader {
  load(path: string): Promise<OpenAPIDocument>;
}
