import { attachmentMethods } from "../attachments/service.js";
import { calendarMethods } from "../calendar/service.js";
import { communicationMethods } from "../communications/service.js";
import { customerMethods } from "../customers/service.js";
import { dashboardMethods } from "../dashboard/service.js";
import { invoiceMethods } from "../invoices/service.js";
import { orderMethods } from "../orders/service.js";
import { quoteMethods } from "../quotes/service.js";
import { installDomainMethods } from "../install.js";

const GENERAL_DOMAIN_INSTALLED = Symbol.for("signguy.slim.generalDomainInstalled");

export function installGeneralDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "general",
    installedSymbol: GENERAL_DOMAIN_INSTALLED,
    methodGroups: [communicationMethods, customerMethods, quoteMethods, orderMethods, calendarMethods, dashboardMethods, attachmentMethods, invoiceMethods],
  });
}
