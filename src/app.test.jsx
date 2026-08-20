// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import App from "./App.jsx";
import { downloadApiFile } from "./api.js";
import { enabledNavigationItems, enabledRibbonActions, VERSION_1_NAVIGATION } from "./navigation.js";
import { assertNoForbiddenImports, findForbiddenImports } from "./exclusionGuard.js";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("Version 1 Part 2 navigation boundary", () => {
  it("renders completed Part 2 routes and keeps later parts hidden", () => {
    expect(enabledNavigationItems().map((item) => item.key)).toEqual([
      "home",
      "customers",
      "estimates",
      "orders",
      "invoices",
      "settings",
    ]);
    expect(enabledNavigationItems().map((item) => item.key)).not.toContain("production");
    expect(enabledNavigationItems().map((item) => item.key)).not.toContain("calendar");
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

  it("enables complete ribbon actions only for Part 2 workflows", () => {
    expect(enabledRibbonActions().map((action) => action.key)).toEqual([
      "new-customer",
      "new-estimate",
      "new-order",
      "new-invoice",
      "calculator",
    ]);
  });
});

describe("Part 2 UI", () => {
  it("renders calculator arithmetic and copy-only workflow", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    fireEvent.click(screen.getByText("Register"));
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "password123" } });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        access_token: "token",
        user: { role: "owner" },
        tenant: { company_name: "Acme Signs" },
      }),
    });
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("New Customer")).toBeTruthy();
    fireEvent.click(screen.getByText("Calculator"));
    fireEvent.click(screen.getByText("7"));
    fireEvent.click(screen.getByText("+"));
    fireEvent.click(screen.getByText("8"));
    fireEvent.click(screen.getByText("="));
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("Copy Result")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("downloads Estimate PDFs through authenticated Blob API calls", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    fireEvent.click(await screen.findByText("Register"));
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "password123" } });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        access_token: "token",
        user: { role: "owner" },
        tenant: { company_name: "Acme Signs" },
      }),
    });
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(await screen.findByText("New Estimate"));
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ items: [] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ users: [] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ items: [{ id: "estimate-1", estimate_number: "E-00001", status: "draft", total_cents: 1200 }] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => new Blob(["pdf"], { type: "application/pdf" }),
    });
    fireEvent.click(await screen.findByText("PDF"));
    expect(fetch).toHaveBeenLastCalledWith("/api/estimates/estimate-1/pdf", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    vi.unstubAllGlobals();
  });

  it("creates and revokes object URLs for authenticated API file downloads", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => new Blob(["pdf"], { type: "application/pdf" }),
    });
    const createObjectURL = vi.fn(() => "blob:invoice");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetch);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await downloadApiFile("/invoices/invoice-1/pdf", { token: "token", filename: "I-00001.pdf" });
    expect(fetch).toHaveBeenCalledWith("/api/invoices/invoice-1/pdf", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
    expect(createObjectURL).toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:invoice");
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("passes ordinary Slim source imports", () => {
    expect(assertNoForbiddenImports('import App from "./App.jsx";')).toBe(true);
  });

  it("uses explicit dependency versions and keeps tooling in devDependencies", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(Object.values({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain("latest");
    expect(pkg.dependencies.bcryptjs).toBe("3.0.3");
    expect(pkg.dependencies.zod).toBe("4.4.3");
    expect(pkg.dependencies).not.toHaveProperty("vite");
    expect(pkg.dependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(pkg.devDependencies).toHaveProperty("vite", "8.2.2");
    expect(pkg.engines).toEqual({ node: "24.16.0", npm: "11.13.0" });
  });
});
