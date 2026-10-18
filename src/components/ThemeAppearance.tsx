"use client";
import { useEffect } from "react";
export default function ThemeAppearance() {
  useEffect(() => {
    let alive = true;
    const apply = (theme: string) => document.documentElement.classList.toggle("theme-truck-dashboard", theme === "truck_dashboard");
    fetch("/api/admin/theme", { credentials: "same-origin", cache: "no-store" }).then(async r => { if (r.ok && alive) { const theme = (await r.json()).theme; apply(theme); window.dispatchEvent(new CustomEvent("copalinks-theme", { detail: theme })); } }).catch(() => {});
    const change = (event: Event) => apply((event as CustomEvent<string>).detail);
    window.addEventListener("copalinks-theme", change);
    return () => { alive = false; window.removeEventListener("copalinks-theme", change); document.documentElement.classList.remove("theme-truck-dashboard"); };
  }, []);
  return null;
}
