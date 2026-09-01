import { describe, expect, it } from "vitest";
import { installEmployeeDomain } from "./index.js";

describe("employee domain installer", () => {
  it("installs employee domain methods once", () => {
    class EmptyService {}

    installEmployeeDomain(EmptyService);
    installEmployeeDomain(EmptyService);

    expect(typeof EmptyService.prototype.activeEmployeeForActor).toBe("function");
    expect(typeof EmptyService.prototype.createEmployee).toBe("function");
    expect(typeof EmptyService.prototype.clockIn).toBe("function");
    expect(typeof EmptyService.prototype.paySummary).toBe("function");
    expect(typeof EmptyService.prototype.createAnnouncement).toBe("function");
    expect(typeof EmptyService.prototype.sendDirectMessage).toBe("function");
  });

  it("rejects method collisions on the service prototype", () => {
    class CollidingService {
      clockIn() {}
    }

    expect(() => installEmployeeDomain(CollidingService)).toThrow("employee_domain_method_collision:clockIn");
  });
});
