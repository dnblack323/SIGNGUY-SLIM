export const FORBIDDEN_FRONTEND_IMPORT_PATTERNS = [
  "/pricing",
  "pricing-engine",
  "pricingCalculator",
  "detailed-entry",
  "aiStudio",
  "/ai",
  "webstore",
  "stripe",
  "expense",
  "payroll",
  "timeClock",
  "employeePortal",
  "message",
  "announcement",
  "camera",
  "annotation",
  "twilio",
  "portal",
  "inventory",
  "wrapLab",
  "designStudio",
  "decisionRoom",
  "emailHistory",
  "sendgrid",
];

export function findForbiddenImports(sourceText) {
  const importLines = sourceText
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => /^(import|export)\s/.test(line));

  return importLines.flatMap(({ line, lineNumber }) =>
    FORBIDDEN_FRONTEND_IMPORT_PATTERNS
      .filter((pattern) => line.toLowerCase().includes(pattern.toLowerCase()))
      .map((pattern) => ({ pattern, line, lineNumber })),
  );
}

export function assertNoForbiddenImports(sourceText) {
  const violations = findForbiddenImports(sourceText);
  if (violations.length) {
    const details = violations.map((item) => `${item.pattern} at line ${item.lineNumber}`).join(", ");
    throw new Error(`Forbidden Slim import detected: ${details}`);
  }
  return true;
}
