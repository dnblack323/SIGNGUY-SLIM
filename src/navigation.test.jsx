import { describe, expect, it } from "vitest";
import { enabledNavigationItems, enabledRibbonActions, VERSION_1_NAVIGATION } from "./navigation.js";
import { assertNoForbiddenImports, findForbiddenImports } from "./exclusionGuard.js";

describe("Version 1 Part 1 navigation boundary", () => {
  it("renders only complete Part 1 routes", () => {
    expect(enabledNavigationItems().map((item) => item.key)).toEqual(["home", "settings"]);
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
});

describe("excluded import guard", () => {
  it("flags full-MVP and future-module imports", () => {
    expect(findForbiddenImports('import TimeClock from "@/pages/TimeClockPage.jsx";')).toHaveLength(1);
  });

  it("passes ordinary Slim shell imports", () => {
    expect(assertNoForbiddenImports('import App from "./App.jsx";')).toBe(true);
  });
});
