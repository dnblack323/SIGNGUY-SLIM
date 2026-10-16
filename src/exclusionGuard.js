export const FORBIDDEN_FRONTEND_IMPORT_PATTERNS = [
  "pricing",
  "pricing-engine",
  "pricing_engine",
  "pricingCalculator",
  "detailed-entry",
  "detailedEntry",
  "material",
  "labor",
  "overhead",
  "markup",
  "square-foot",
  "machine",
  "costFormula",
  "aiStudio",
  "aiGateway",
  "ai-",
  "webstore",
  "stripe",
  "expense",
  "bookkeeping",
  "accounting",
  "payroll",
  "time-clock",
  "timeClock",
  "employeePortal",
  "employee-portal",
  "message",
  "announcement",
  "camera",
  "annotation",
  "twilio",
  "portal",
  "decisionRoom",
  "decision-room",
  "inventory",
  "purchasing",
  "supplier",
  "wrapLab",
  "wrap-lab",
  "designStudio",
  "design-studio",
  "emailHistory",
  "email-history",
  "sendgrid",
  "gmail",
  "outlook",
];

function specifierMatchesExcludedPattern(specifier, pattern) {
  const value = String(specifier || "").toLowerCase();
  const needle = String(pattern || "").toLowerCase();
  if (!needle) return false;
  // "platform" contains the substring "portal"; do not treat Platform Creator
  // modules as the deferred customer-portal exclusion.
  if (needle === "portal") return value.replaceAll("platform", "").includes("portal");
  return value.includes(needle);
}

export function findForbiddenImports(sourceText) {
  const importExpressions = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  return sourceText.split(/\r?\n/).flatMap((line, index) => {
    const lineNumber = index + 1;
    return importExpressions.flatMap((expression) => {
      expression.lastIndex = 0;
      const matches = [];
      let match;
      while ((match = expression.exec(line)) !== null) {
        const specifier = match[1];
        for (const pattern of FORBIDDEN_FRONTEND_IMPORT_PATTERNS) {
          if (specifierMatchesExcludedPattern(specifier, pattern)) {
            matches.push({ pattern, specifier, line: line.trim(), lineNumber });
          }
        }
      }
      return matches;
    });
  });
}

export function assertNoForbiddenImports(sourceText) {
  const violations = findForbiddenImports(sourceText);
  if (violations.length) {
    const details = violations.map((item) => `${item.pattern} at line ${item.lineNumber}`).join(", ");
    throw new Error(`Forbidden Slim import detected: ${details}`);
  }
  return true;
}
