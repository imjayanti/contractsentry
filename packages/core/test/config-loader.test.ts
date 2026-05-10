import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CsentryConfigLoader } from "../src/infrastructure/config/CsentryConfigLoader.js";

describe("CsentryConfigLoader", () => {
  let dir: string;
  let loader: CsentryConfigLoader;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "csentry-test-"));
    loader = new CsentryConfigLoader();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("returns null when no config file exists", async () => {
    const config = await loader.load(dir);
    expect(config).toBeNull();
  });

  it("loads spec path from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      `export default { spec: './api.yaml' }`,
    );
    const config = await loader.load(dir);
    expect(config?.spec).toBe("./api.yaml");
  });

  it("loads files glob from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      `export default { files: ['src/**/*.ts'] }`,
    );
    const config = await loader.load(dir);
    expect(config?.files).toEqual(["src/**/*.ts"]);
  });

  it("loads ignore list from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      `export default { ignore: ['GET /internal/*'] }`,
    );
    const config = await loader.load(dir);
    expect(config?.ignore).toEqual(["GET /internal/*"]);
  });

  it("loads strict and audit flags from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { strict: true, audit: false }",
    );
    const config = await loader.load(dir);
    expect(config?.strict).toBe(true);
    expect(config?.audit).toBe(false);
  });
});
