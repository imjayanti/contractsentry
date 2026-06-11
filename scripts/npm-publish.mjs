#!/usr/bin/env node
// Publishes unpublished packages using npm publish from each package directory.
// Publishing from a directory (not a tarball) is required for npm to trigger
// the trusted-publisher OIDC exchange. workspace:* deps in cli are temporarily
// resolved to real versions before publishing, then restored.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PACKAGES = ["packages/core", "packages/cli"];
let anyPublished = false;

for (const dir of PACKAGES) {
  const absDir = join(ROOT, dir);
  const pkgPath = join(absDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  let current;
  try {
    current = execSync(`npm view ${pkg.name} version`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    current = "0.0.0";
  }

  if (current === pkg.version) {
    console.log(`${pkg.name}@${pkg.version} already published, skipping`);
    continue;
  }

  console.log(`\nPublishing ${pkg.name}@${pkg.version}`);

  // Temporarily replace workspace:* with real versions so npm understands them
  const originalJson = readFileSync(pkgPath, "utf8");
  let patched = false;

  if (pkg.dependencies) {
    for (const [dep, ver] of Object.entries(pkg.dependencies)) {
      if (typeof ver === "string" && ver.startsWith("workspace:")) {
        const localName = dep.replace(/^@contractsentry\//, "");
        const localPkg = JSON.parse(
          readFileSync(
            join(ROOT, "packages", localName, "package.json"),
            "utf8",
          ),
        );
        pkg.dependencies[dep] = `^${localPkg.version}`;
        patched = true;
      }
    }
    if (patched) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  try {
    execSync("npm publish --access public --provenance", {
      cwd: absDir,
      stdio: "inherit",
    });
    anyPublished = true;
    console.log(`✓ ${pkg.name}@${pkg.version} published`);
  } finally {
    if (patched) writeFileSync(pkgPath, originalJson);
  }
}

if (anyPublished && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, "published=true\n");
}
