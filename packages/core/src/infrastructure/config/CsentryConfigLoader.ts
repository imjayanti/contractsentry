import { access } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
import type {
  CsentryConfig,
  IConfigLoader,
} from "../../domain/IConfigLoader.js";

const jiti = createJiti(import.meta.url);

export class CsentryConfigLoader implements IConfigLoader {
  async load(dir: string): Promise<CsentryConfig | null> {
    const configPath = join(dir, "csentry.config.ts");

    try {
      await access(configPath);
    } catch {
      return null;
    }

    const mod = (await jiti.import(configPath)) as { default?: CsentryConfig };
    return mod.default ?? null;
  }
}
