import { employeeAnnouncementMethods } from "./announcements.js";
import { employeeCapabilityMethods } from "./capabilities.js";
import { employeeAdminMethods } from "./employees.js";
import { employeeMessageMethods } from "./messages.js";
import { employeePayMethods } from "./pay.js";
import { employeeTimeMethods } from "./time.js";
import { installDomainMethods } from "../install.js";

const EMPLOYEE_DOMAIN_INSTALLED = Symbol.for("signguy.slim.employeeDomainInstalled");
const EMPLOYEE_METHOD_GROUPS = [
  employeeCapabilityMethods,
  employeeAdminMethods,
  employeeTimeMethods,
  employeePayMethods,
  employeeAnnouncementMethods,
  employeeMessageMethods,
];

export function installEmployeeDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "employee",
    installedSymbol: EMPLOYEE_DOMAIN_INSTALLED,
    methodGroups: EMPLOYEE_METHOD_GROUPS,
  });
}
