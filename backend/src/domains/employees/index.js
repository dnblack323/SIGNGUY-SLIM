import { employeeAnnouncementMethods } from "./announcements.js";
import { employeeCapabilityMethods } from "./capabilities.js";
import { employeeAdminMethods } from "./employees.js";
import { employeeMessageMethods } from "./messages.js";
import { employeePayMethods } from "./pay.js";
import { employeeTimeMethods } from "./time.js";

export function installEmployeeDomain(SlimService) {
  Object.assign(
    SlimService.prototype,
    employeeCapabilityMethods,
    employeeAdminMethods,
    employeeTimeMethods,
    employeePayMethods,
    employeeAnnouncementMethods,
    employeeMessageMethods,
  );
}
