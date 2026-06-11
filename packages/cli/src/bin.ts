#!/usr/bin/env node
import { createRequire } from "node:module";
import { program } from "commander";
import { type CheckOptions, runCheck } from "./commands/check.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

program
  .name("csentry")
  .description("Validate TypeScript return shapes against OpenAPI contracts")
  .version(version);

program
  .command("check")
  .description("Scan TypeScript files and report contract violations")
  .option("--spec <path>", "path to OpenAPI spec file")
  .option("--files <glob...>", "glob pattern(s) of TypeScript files to scan")
  .option("--ai", "enable AI-powered drift detection via Anthropic")
  .option(
    "--audit",
    "report violations but always exit 0 (gradual CI adoption)",
  )
  .option("--strict", "exit 1 on any violation including warnings")
  .option(
    "--format <format>",
    "output format: table (default) or json",
    "table",
  )
  .action(async (opts: CheckOptions) => {
    try {
      const code = await runCheck(opts);
      process.exit(code);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  });

program.parse();
