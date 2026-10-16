import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PlatformApp from "./platform/PlatformApp.jsx";
import KioskApp from "./features/kiosk/KioskApp.jsx";
import "./styles.css";
import "./platform/platform.css";
import "./features/kiosk/kiosk.css";

const pathname = window.location.pathname;
const isPlatformRoute = pathname === "/platform" || pathname.startsWith("/platform/");
const isKioskRoute = pathname === "/kiosk" || pathname.startsWith("/kiosk/");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isPlatformRoute ? <PlatformApp /> : isKioskRoute ? <KioskApp /> : <App />}
  </React.StrictMode>,
);
