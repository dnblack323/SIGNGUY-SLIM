import {
  Briefcase,
  CalendarDays,
  Calculator,
  Clock,
  DollarSign,
  FileText,
  Home,
  KanbanSquare,
  LogOut,
  Megaphone,
  MessageSquare,
  ReceiptText,
  Settings,
  ShoppingBag,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";

const WRITE_ROLES = ["owner", "admin", "manager", "staff"];
const ADMIN_ROLES = ["owner", "admin"];
const MANAGER_ROLES = ["owner", "admin", "manager"];

export const AREA_NAVIGATION = [
  {
    key: "home",
    label: "Home",
    href: "#/",
    route: "/",
    accent: "#255b73",
    icon: Home,
    kind: "home",
    matchPrefixes: ["/"],
    modules: [],
  },
  {
    key: "shop",
    label: "Shop Operations",
    href: "#/customers",
    route: "/customers",
    accent: "#255b73",
    icon: ShoppingBag,
    kind: "operational",
    matchPrefixes: ["/customers", "/estimates", "/orders"],
    modules: [
      { key: "customers", label: "Customers", href: "#/customers", matchPrefixes: ["/customers"] },
      { key: "quotes", label: "Quotes", href: "#/estimates", matchPrefixes: ["/estimates"] },
      {
        key: "orders",
        label: "Orders",
        href: "#/orders",
        matchPrefixes: ["/orders"],
        children: [
          { key: "incoming-requests", label: "Incoming Requests", href: "#/orders/incoming", matchPrefixes: ["/orders/incoming"] },
        ],
      },
    ],
  },
  {
    key: "team",
    label: "Team & Productivity",
    href: "#/production",
    route: "/production",
    accent: "#75638F",
    icon: KanbanSquare,
    kind: "operational",
    matchPrefixes: ["/production", "/calendar", "/employees", "/time", "/announcements"],
    modules: [
      { key: "employees", label: "Employees", href: "#/employees", matchPrefixes: ["/employees"], capabilities: ["can_manage_employees"] },
      { key: "time", label: "Time & Attendance", href: "#/time", matchPrefixes: ["/time"], capabilities: ["can_review_time"] },
      { key: "work-board", label: "Work Board", href: "#/production", matchPrefixes: ["/production"] },
      { key: "calendar", label: "Calendar", href: "#/calendar", matchPrefixes: ["/calendar"] },
      { key: "announcements", label: "Announcements", href: "#/announcements", matchPrefixes: ["/announcements"], capabilities: ["can_manage_announcements"] },
    ],
  },
  {
    key: "business",
    label: "Business Management",
    href: "#/invoices",
    route: "/invoices",
    accent: "#227C7A",
    icon: Briefcase,
    kind: "operational",
    matchPrefixes: ["/invoices", "/payments", "/payroll"],
    modules: [
      { key: "invoices", label: "Invoices", href: "#/invoices", matchPrefixes: ["/invoices"] },
      { key: "payments", label: "Payments", href: "#/payments", matchPrefixes: ["/payments"] },
      { key: "payroll", label: "Payroll", href: "#/payroll", matchPrefixes: ["/payroll"], capabilities: ["can_manage_pay"] },
    ],
  },
  {
    key: "employee-portal",
    label: "Employee Portal",
    href: "#/employee-portal/time-clock",
    route: "/employee-portal/time-clock",
    accent: "#4f6f52",
    icon: Clock,
    kind: "operational",
    matchPrefixes: ["/employee-portal"],
    capabilities: ["can_use_employee_portal"],
    modules: [
      { key: "time-clock", label: "Time Clock", href: "#/employee-portal/time-clock", matchPrefixes: ["/employee-portal/time-clock"] },
      { key: "my-pay", label: "My Pay", href: "#/employee-portal/my-pay", matchPrefixes: ["/employee-portal/my-pay"] },
      { key: "messages", label: "Messages", href: "#/employee-portal/messages", matchPrefixes: ["/employee-portal/messages"] },
      { key: "announcements", label: "Announcements", href: "#/employee-portal/announcements", matchPrefixes: ["/employee-portal/announcements"] },
    ],
  },
];

export const UTILITY_NAVIGATION = [
  {
    key: "settings",
    label: "Settings",
    href: "#/settings",
    accent: "#64748b",
    icon: Settings,
    matchPrefixes: ["/settings", "/backup"],
    modules: [
      { key: "company", label: "Company", href: "#/settings", matchPrefixes: ["/settings"] },
      { key: "backup", label: "Backup & Restore", href: "#/backup", matchPrefixes: ["/backup"] },
    ],
  },
  { key: "sign-out", label: "Sign Out", icon: LogOut, action: "logout" },
];

export const QUICK_ACCESS_ACTIONS = [
  { key: "new-order", label: "New Order", href: "#/orders/new", icon: ShoppingBag, roles: WRITE_ROLES },
  { key: "new-customer", label: "New Customer", href: "#/customers", icon: UserPlus, roles: WRITE_ROLES },
  { key: "calendar", label: "Calendar", href: "#/calendar", icon: CalendarDays, roles: WRITE_ROLES },
  { key: "calculator", label: "Calculator", icon: Calculator },
];

export const VERSION_1_NAVIGATION = AREA_NAVIGATION;

function normalizeRoute(route = "/") {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return normalized === "" ? "/" : normalized;
}

function matchesPrefix(route, prefixes = []) {
  return prefixes.some((prefix) => {
    if (prefix === "/") return route === "/";
    return route === prefix || route.startsWith(`${prefix}/`);
  });
}

function roleAllowed(item, role) {
  return !role || !item.roles || item.roles.includes(role);
}

function capabilityAllowed(item, capabilities) {
  if (!item.capabilities || capabilities === undefined) return true;
  return item.capabilities.every((capability) => Boolean(capabilities?.[capability]));
}

export function filterNavigationForRole(items = [], role, capabilities) {
  return items
    .filter((item) => roleAllowed(item, role) && capabilityAllowed(item, capabilities))
    .map((item) => {
      const children = item.children ? filterNavigationForRole(item.children, role, capabilities) : undefined;
      const modules = item.modules ? filterNavigationForRole(item.modules, role, capabilities) : undefined;
      return { ...item, ...(children ? { children } : {}), ...(modules ? { modules } : {}) };
    });
}

function firstMatching(items, route) {
  return items.find((item) => matchesPrefix(route, item.matchPrefixes || [item.route]));
}

export function getRouteContext(route = "/") {
  const normalized = normalizeRoute(route);
  const utility = firstMatching(UTILITY_NAVIGATION.filter((item) => item.matchPrefixes), normalized);
  if (utility?.key === "settings") {
    const module = firstMatching(utility.modules, normalized) || utility.modules[0];
    return {
      area: utility,
      module,
      child: null,
      areaKey: utility.key,
      moduleKey: module.key,
      pageLabel: module.label,
      accent: utility.accent,
      isUtility: true,
    };
  }
  const area = firstMatching(AREA_NAVIGATION, normalized) || AREA_NAVIGATION[0];
  const module = firstMatching(area.modules || [], normalized) || area.modules?.[0] || null;
  const child = module?.children ? firstMatching(module.children, normalized) || null : null;
  return {
    area,
    module,
    child,
    areaKey: area.key,
    moduleKey: module?.key || area.key,
    childKey: child?.key || null,
    pageLabel: child?.label || module?.label || area.label,
    accent: area.accent,
    isUtility: false,
  };
}

export function enabledNavigationItems(items = AREA_NAVIGATION, role, capabilities) {
  return filterNavigationForRole(items, role, capabilities);
}

export function enabledOperationalAreas(items = AREA_NAVIGATION, role, capabilities) {
  return filterNavigationForRole(items, role, capabilities).filter((item) => item.kind === "operational");
}

export function enabledQuickAccess(role) {
  return QUICK_ACCESS_ACTIONS.filter((action) => !action.roles || action.roles.includes(role));
}

export function enabledUtilityItems(role, capabilities) {
  return UTILITY_NAVIGATION.filter((item) => (roleAllowed(item, role) && capabilityAllowed(item, capabilities)) || item.key === "sign-out");
}

export function enabledRibbonActions(actions = []) {
  return actions;
}

export const ROUTE_ICON_BY_PAGE = {
  customers: Users,
  estimates: FileText,
  orders: ShoppingBag,
  production: KanbanSquare,
  calendar: CalendarDays,
  employees: Users,
  time: Clock,
  announcements: Megaphone,
  invoices: ReceiptText,
  payments: WalletCards,
  payroll: DollarSign,
  "employee-portal": MessageSquare,
  settings: Settings,
  backup: Settings,
};

export { ADMIN_ROLES, MANAGER_ROLES, WRITE_ROLES };
