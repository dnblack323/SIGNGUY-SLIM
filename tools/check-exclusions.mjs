import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findForbiddenImports } from "../src/exclusionGuard.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIRS = ["src"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path;
  });
}

const violations = SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
  .filter((file) => /\.(js|jsx|ts|tsx)$/.test(file))
  .filter((file) => !file.endsWith("exclusionGuard.js"))
  .flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return findForbiddenImports(text).map((violation) => ({ file, ...violation }));
  });

if (violations.length) {
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.lineNumber} imports excluded pattern ${violation.pattern}`);
  }
  process.exit(1);
}

console.log("No excluded Version 2 or full-MVP imports found in Slim source.");
