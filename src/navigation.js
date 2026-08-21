import {
  CalendarDays,
  Calculator,
  FileText,
  Home,
  KanbanSquare,
  ReceiptText,
  Settings,
  ShoppingBag,
  UserPlus,
  Users,
} from "lucide-react";

export const VERSION_1_NAVIGATION = [
  { key: "home", label: "Home", href: "#/", icon: Home, availableInPart2: true },
  { key: "customers", label: "Customers", href: "#/customers", icon: Users, availableInPart2: true },
  { key: "estimates", label: "Estimates", href: "#/estimates", icon: FileText, availableInPart2: true },
  { key: "orders", label: "Orders", href: "#/orders", icon: ShoppingBag, availableInPart2: true },
  { key: "production", label: "Production", href: "#/production", icon: KanbanSquare, availableInPart2: true },
  { key: "calendar", label: "Calendar", href: "#/calendar", icon: CalendarDays, availableInPart2: true },
  { key: "invoices", label: "Invoices", href: "#/invoices", icon: ReceiptText, availableInPart2: true },
  { key: "settings", label: "Settings", href: "#/settings", icon: Settings, availableInPart2: true },
];

export const VERSION_1_RIBBON_ACTIONS = [
  { key: "new-customer", label: "New Customer", icon: UserPlus, requiresRoute: "customers" },
  { key: "new-estimate", label: "New Estimate", icon: FileText, requiresRoute: "estimates" },
  { key: "new-order", label: "New Order", icon: ShoppingBag, requiresRoute: "orders" },
  { key: "schedule-job", label: "Schedule Event", icon: CalendarDays, requiresRoute: "calendar" },
  { key: "open-calendar", label: "Open Calendar", icon: CalendarDays, requiresRoute: "calendar" },
  { key: "open-production", label: "Open Production", icon: KanbanSquare, requiresRoute: "production" },
  { key: "new-invoice", label: "New Invoice", icon: ReceiptText, requiresRoute: "invoices" },
  { key: "calculator", label: "Calculator", icon: Calculator, requiresRoute: "calculator" },
];

export function enabledNavigationItems(items = VERSION_1_NAVIGATION) {
  return items.filter((item) => item.availableInPart2);
}

export function enabledRibbonActions(actions = VERSION_1_RIBBON_ACTIONS) {
  const enabledRoutes = new Set(enabledNavigationItems().map((item) => item.key));
  return actions.filter((action) => action.key === "calculator" || enabledRoutes.has(action.requiresRoute));
}
