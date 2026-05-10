export interface CsentryConfig {
  spec?: string;
  files?: string[];
  strict?: boolean;
  audit?: boolean;
  ignore?: string[];
}

export interface IConfigLoader {
  load(dir: string): Promise<CsentryConfig | null>;
}
