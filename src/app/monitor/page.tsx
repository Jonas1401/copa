import type { Metadata } from "next";
import MonitorDashboard from "@/components/monitor/MonitorDashboard";

export const metadata: Metadata = {
  title: "Monitor WhatsApp · CopaLinks",
  robots: { index: false, follow: false },
};

export default function MonitorPage() {
  return <MonitorDashboard />;
}
