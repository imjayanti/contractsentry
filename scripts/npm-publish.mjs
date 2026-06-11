#!/usr/bin/env node
// Publishes unpublished packages using pnpm pack + npm publish.
// pnpm pack replaces workspace:* with real versions; npm publish uses the
// OIDC trusted-publisher flow so no npm token is needed.
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = ["packages/core", "packages/cli"];
let anyPublished = false;

for (const dir of PACKAGES) {
  const { name, version } = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  );

  let current;
  try {
    current = execSync(`npm view ${name} version`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    current = "0.0.0";
  }

  if (current === version) {
    console.log(`${name}@${version} already published, skipping`);
    continue;
  }

  console.log(`\nPublishing ${name}@${version}`);

  const packOut = execSync("pnpm pack --no-git-checks", {
    cwd: dir,
    encoding: "utf8",
  });
  const tarball = packOut.trim().split("\n").pop().trim();

  execSync(`npm publish ${tarball} --access public`, {
    cwd: dir,
    stdio: "inherit",
  });

  rmSync(join(dir, tarball), { force: true });
  anyPublished = true;
  console.log(`✓ ${name}@${version} published`);
}

if (anyPublished && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, "published=true\n");
}
