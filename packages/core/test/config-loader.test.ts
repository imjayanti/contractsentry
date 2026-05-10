import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  // ── existence ─────────────────────────────────────────────────────────────

  it("returns null when no config file exists", async () => {
    expect(await loader.load(dir)).toBeNull();
  });

  // ── valid configs ─────────────────────────────────────────────────────────

  it("loads spec path from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { spec: './api.yaml' }",
    );
    const config = await loader.load(dir);
    expect(config?.spec).toBe("./api.yaml");
  });

  it("loads files glob from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { files: ['src/**/*.ts'] }",
    );
    const config = await loader.load(dir);
    expect(config?.files).toEqual(["src/**/*.ts"]);
  });

  it("loads ignore list from config", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { ignore: ['GET /internal/*'] }",
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

  it("loads a partial config with only spec defined", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { spec: './api.yaml' }",
    );
    const config = await loader.load(dir);
    expect(config?.spec).toBe("./api.yaml");
    expect(config?.files).toBeUndefined();
    expect(config?.strict).toBeUndefined();
  });

  it("loads config with unknown keys without throwing", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { unknown: true }",
    );
    expect(await loader.load(dir)).not.toBeNull();
  });

  // jiti creates a synthetic CJS default for named-export-only modules —
  // mod.default resolves to the full exports object, indistinguishable from
  // an intentional default. Config is returned rather than null.
  it("treats named-export-only module as a valid config object", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export const spec = './api.yaml'",
    );
    const config = await loader.load(dir);
    expect(config).not.toBeNull();
  });

  // ── null / invalid default export ────────────────────────────────────────

  it("returns null when config exports a non-object (string)", async () => {
    await writeFile(join(dir, "csentry.config.ts"), "export default 'invalid'");
    expect(await loader.load(dir)).toBeNull();
  });

  it("returns null when config exports a non-object (array)", async () => {
    await writeFile(join(dir, "csentry.config.ts"), "export default []");
    expect(await loader.load(dir)).toBeNull();
  });

  // jiti performs a thenable check on the module export — null causes it to throw
  // internally. This is expected: exporting null from a config file is invalid.
  it("throws when config exports null", async () => {
    await writeFile(join(dir, "csentry.config.ts"), "export default null");
    await expect(loader.load(dir)).rejects.toThrow();
  });

  // ── errors ────────────────────────────────────────────────────────────────

  it("throws when config file has a syntax error", async () => {
    await writeFile(
      join(dir, "csentry.config.ts"),
      "export default { broken: ",
    );
    await expect(loader.load(dir)).rejects.toThrow();
  });
});
