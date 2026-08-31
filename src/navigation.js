import {
  Bell,
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
  UserCircle,
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
      {
        key: "sales",
        label: "Sales",
        href: "#/estimates",
        matchPrefixes: ["/estimates", "/orders"],
        children: [
          { key: "estimates", label: "Estimates", href: "#/estimates", matchPrefixes: ["/estimates"] },
          { key: "order-intake", label: "Order Intake", href: "#/orders/intake", matchPrefixes: ["/orders/intake"] },
          { key: "orders", label: "Orders", href: "#/orders", matchPrefixes: ["/orders"] },
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
    matchPrefixes: ["/production", "/tasks", "/calendar", "/employees", "/time", "/announcements"],
    modules: [
      { key: "employees", label: "Employees", href: "#/employees", matchPrefixes: ["/employees"], roles: MANAGER_ROLES },
      { key: "time", label: "Time & Attendance", href: "#/time", matchPrefixes: ["/time"], roles: MANAGER_ROLES },
      { key: "work-board", label: "Work Board", href: "#/production", matchPrefixes: ["/production", "/tasks"] },
      { key: "calendar", label: "Calendar", href: "#/calendar", matchPrefixes: ["/calendar"] },
      { key: "announcements", label: "Announcements", href: "#/announcements", matchPrefixes: ["/announcements"], roles: ADMIN_ROLES },
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
      {
        key: "money",
        label: "Money",
        href: "#/invoices",
        matchPrefixes: ["/invoices", "/payments"],
        children: [
          { key: "invoices", label: "Invoices", href: "#/invoices", matchPrefixes: ["/invoices"] },
          { key: "payments", label: "Payments", href: "#/payments", matchPrefixes: ["/payments"] },
          { key: "payroll", label: "Payroll", href: "#/payroll", matchPrefixes: ["/payroll"], roles: MANAGER_ROLES },
        ],
      },
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
    modules: [
      {
        key: "portal",
        label: "Restricted Portal",
        href: "#/employee-portal/time-clock",
        matchPrefixes: ["/employee-portal"],
        children: [
          { key: "time-clock", label: "Time Clock", href: "#/employee-portal/time-clock", matchPrefixes: ["/employee-portal/time-clock"] },
          { key: "my-pay", label: "My Pay", href: "#/employee-portal/my-pay", matchPrefixes: ["/employee-portal/my-pay"] },
          { key: "announcements", label: "Announcements", href: "#/employee-portal/announcements", matchPrefixes: ["/employee-portal/announcements"] },
          { key: "messages", label: "Messages", href: "#/employee-portal/messages", matchPrefixes: ["/employee-portal/messages"] },
        ],
      },
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
    matchPrefixes: ["/settings", "/backup", "/pricing"],
    modules: [
      { key: "company", label: "Company", href: "#/settings", matchPrefixes: ["/settings", "/pricing"] },
      { key: "backup", label: "Backup & Restore", href: "#/backup", matchPrefixes: ["/backup"] },
    ],
  },
  { key: "notifications", label: "Notifications", href: "#/", icon: Bell, matchPrefixes: ["/"] },
  { key: "account", label: "Account", href: "#/settings", icon: UserCircle, matchPrefixes: ["/settings"] },
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

export function filterNavigationForRole(items = [], role) {
  return items
    .filter((item) => roleAllowed(item, role))
    .map((item) => {
      const children = item.children ? filterNavigationForRole(item.children, role) : undefined;
      const modules = item.modules ? filterNavigationForRole(item.modules, role) : undefined;
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
  const child = module?.children ? firstMatching(module.children, normalized) || module.children[0] : null;
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

export function enabledNavigationItems(items = AREA_NAVIGATION, role) {
  return filterNavigationForRole(items, role);
}

export function enabledOperationalAreas(items = AREA_NAVIGATION, role) {
  return filterNavigationForRole(items, role).filter((item) => item.kind === "operational");
}

export function enabledQuickAccess(role) {
  return QUICK_ACCESS_ACTIONS.filter((action) => !action.roles || action.roles.includes(role));
}

export function enabledUtilityItems(role) {
  return UTILITY_NAVIGATION.filter((item) => !item.roles || item.roles.includes(role) || item.key === "sign-out");
}

export function enabledRibbonActions(actions = []) {
  return actions;
}

export const ROUTE_ICON_BY_PAGE = {
  customers: Users,
  estimates: FileText,
  orders: ShoppingBag,
  production: KanbanSquare,
  tasks: KanbanSquare,
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
  pricing: Settings,
};

export { ADMIN_ROLES, MANAGER_ROLES, WRITE_ROLES };
