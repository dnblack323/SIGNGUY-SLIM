import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findForbiddenImports, FORBIDDEN_FRONTEND_IMPORT_PATTERNS } from "../src/exclusionGuard.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIRS = ["src", "backend/src"];
const ALLOWED_EXCLUDED_IMPORTS = [
  {
    file: /backend[\\/]src[\\/]domains[\\/]employees[\\/]index\.js$/,
    specifier: /^\.\/(?:announcements|messages)\.js$/,
  },
];

function isAllowedExcludedImport(file, violation) {
  return ALLOWED_EXCLUDED_IMPORTS.some((entry) => entry.file.test(file) && entry.specifier.test(violation.specifier));
}

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
  .filter((file) => !/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(file))
  .filter((file) => !file.endsWith("exclusionGuard.js"))
  .flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return findForbiddenImports(text)
      .filter((violation) => !isAllowedExcludedImport(file, violation))
      .map((violation) => ({ file, ...violation }));
  });

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const dependencyViolations = Object.entries({
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
}).flatMap(([name, version]) =>
  FORBIDDEN_FRONTEND_IMPORT_PATTERNS
    .filter((pattern) => name.toLowerCase().includes(pattern.toLowerCase()))
    .map((pattern) => ({ name, version, pattern })),
);

if (violations.length || dependencyViolations.length) {
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.lineNumber} imports excluded pattern ${violation.pattern} from ${violation.specifier}`);
  }
  for (const violation of dependencyViolations) {
    console.error(`package.json dependency ${violation.name}@${violation.version} matches excluded pattern ${violation.pattern}`);
  }
  process.exit(1);
}

console.log("No excluded later-stage or full-MVP imports or dependencies found in Slim source.");
