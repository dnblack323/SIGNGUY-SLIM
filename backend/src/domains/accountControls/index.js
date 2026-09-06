import { installDomainMethods } from "../install.js";
import { accountControlMethods } from "./service.js";

const ACCOUNT_CONTROLS_DOMAIN_INSTALLED = Symbol.for("signguy.slim.accountControlsDomainInstalled");

export function installAccountControlsDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "accountControls",
    installedSymbol: ACCOUNT_CONTROLS_DOMAIN_INSTALLED,
    methodGroups: [accountControlMethods],
  });
}
