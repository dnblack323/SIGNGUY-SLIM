import { employeeAnnouncementMethods } from "./announcements.js";
import { employeeCapabilityMethods } from "./capabilities.js";
import { employeeAdminMethods } from "./employees.js";
import { employeeMessageMethods } from "./messages.js";
import { employeePayMethods } from "./pay.js";
import { employeeTimeMethods } from "./time.js";

const EMPLOYEE_DOMAIN_INSTALLED = Symbol.for("signguy.slim.employeeDomainInstalled");
const EMPLOYEE_METHOD_GROUPS = [
  employeeCapabilityMethods,
  employeeAdminMethods,
  employeeTimeMethods,
  employeePayMethods,
  employeeAnnouncementMethods,
  employeeMessageMethods,
];

function mergedEmployeeDomainMethods() {
  const methods = {};
  for (const group of EMPLOYEE_METHOD_GROUPS) {
    for (const [name, method] of Object.entries(group)) {
      if (Object.prototype.hasOwnProperty.call(methods, name)) {
        throw new Error(`employee_domain_duplicate_method:${name}`);
      }
      methods[name] = method;
    }
  }
  return methods;
}

export function installEmployeeDomain(SlimService) {
  if (SlimService[EMPLOYEE_DOMAIN_INSTALLED]) return;
  const methods = mergedEmployeeDomainMethods();
  const collisions = Object.keys(methods).filter((name) => Object.prototype.hasOwnProperty.call(SlimService.prototype, name));
  if (collisions.length) {
    throw new Error(`employee_domain_method_collision:${collisions.join(",")}`);
  }
  Object.assign(SlimService.prototype, methods);
  Object.defineProperty(SlimService, EMPLOYEE_DOMAIN_INSTALLED, { value: true });
}
