import { access } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
import type {
  CsentryConfig,
  IConfigLoader,
} from "../../domain/IConfigLoader.js";

// TODO: replace jiti with native Node --strip-types once Node 24 LTS is baseline
const jiti = createJiti(import.meta.url);

function isConfig(value: unknown): value is CsentryConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CsentryConfigLoader implements IConfigLoader {
  async load(dir: string): Promise<CsentryConfig | null> {
    const configPath = join(dir, "csentry.config.ts");

    try {
      await access(configPath);
    } catch (err) {
      // only swallow "file not found" — re-throw permission errors etc.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }

    const mod = (await jiti.import(configPath)) as { default?: unknown };
    const config = mod.default ?? null;

    if (!isConfig(config)) return null;

    return config;
  }
}
