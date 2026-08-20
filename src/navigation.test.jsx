import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import App from "./App.jsx";
import { enabledNavigationItems, enabledRibbonActions, VERSION_1_NAVIGATION } from "./navigation.js";
import { assertNoForbiddenImports, findForbiddenImports } from "./exclusionGuard.js";

describe("Version 1 Part 1 navigation boundary", () => {
  it("renders only complete Part 1 routes", () => {
    expect(enabledNavigationItems().map((item) => item.key)).toEqual(["home"]);
  });

  it("keeps the locked Version 1 navigation set without Version 2 sections", () => {
    expect(VERSION_1_NAVIGATION.map((item) => item.label)).toEqual([
      "Home",
      "Customers",
      "Estimates",
      "Orders",
      "Production",
      "Calendar",
      "Invoices",
      "Settings",
    ]);
  });

  it("does not expose quick actions for incomplete pages", () => {
    expect(enabledRibbonActions()).toEqual([]);
  });

  it("keeps runtime UI free of incomplete navigation and developer status copy", () => {
    const html = renderToString(<App />);
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Customers");
    expect(html).not.toContain("Estimates");
    expect(html).not.toContain("Orders");
    expect(html).not.toContain("Version 1 Part 1");
    expect(html).not.toContain("planned");
    expect(html).not.toContain("MVP reference");
  });
});

describe("excluded import guard", () => {
  it("flags full-MVP and future-module imports", () => {
    expect(findForbiddenImports('import TimeClock from "@/pages/TimeClockPage.jsx";')).toHaveLength(1);
  });

  it("flags dynamic imports and CommonJS require calls", () => {
    expect(findForbiddenImports('const mod = await import("@/pages/PricingCalculatorPage.jsx");').length).toBeGreaterThan(0);
    expect(findForbiddenImports('const mod = require("@/pages/EmployeePortal.jsx");').length).toBeGreaterThan(0);
  });

  it("passes ordinary Slim shell imports", () => {
    expect(assertNoForbiddenImports('import App from "./App.jsx";')).toBe(true);
  });

  it("uses explicit dependency versions and keeps tooling in devDependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Object.values({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain("latest");
    expect(pkg.dependencies).not.toHaveProperty("vite");
    expect(pkg.dependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(pkg.devDependencies).toHaveProperty("vite", "8.2.2");
    expect(pkg.engines).toEqual({ node: "24.16.0", npm: "11.13.0" });
  });
});
