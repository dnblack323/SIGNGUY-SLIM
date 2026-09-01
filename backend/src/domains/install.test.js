import { describe, expect, it } from "vitest";
import { installDomainMethods, methodsFromClass } from "./install.js";

describe("domain method installer", () => {
  it("extracts class prototype methods without the constructor", () => {
    class DomainMethods {
      first() {}
      second() {}
    }

    expect(Object.keys(methodsFromClass(DomainMethods))).toEqual(["first", "second"]);
  });

  it("installs method groups idempotently", () => {
    class EmptyService {}
    const installedSymbol = Symbol("testDomainInstalled");
    const ping = () => "pong";

    installDomainMethods(EmptyService, {
      domainName: "test",
      installedSymbol,
      methodGroups: [{ ping }],
    });
    installDomainMethods(EmptyService, {
      domainName: "test",
      installedSymbol,
      methodGroups: [{ ping: () => "overwritten" }],
    });

    expect(new EmptyService().ping()).toBe("pong");
  });

  it("rejects duplicate names across domain groups", () => {
    class EmptyService {}

    expect(() => installDomainMethods(EmptyService, {
      domainName: "test",
      installedSymbol: Symbol("testDomainInstalled"),
      methodGroups: [{ ping() {} }, { ping() {} }],
    })).toThrow("test_domain_duplicate_method:ping");
  });

  it("rejects prototype collisions before installing", () => {
    class CollidingService {
      ping() {}
    }

    expect(() => installDomainMethods(CollidingService, {
      domainName: "test",
      installedSymbol: Symbol("testDomainInstalled"),
      methodGroups: [{ ping() {}, pong() {} }],
    })).toThrow("test_domain_method_collision:ping");
    expect(CollidingService.prototype.pong).toBeUndefined();
  });
});
