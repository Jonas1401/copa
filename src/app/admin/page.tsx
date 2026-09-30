import type { Metadata } from "next";
import AdminApp from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "Configurações de API · CopaLinks",
  robots: { index: false, follow: false },
};

// A tela só mostra dados depois que o servidor confirma a sessão de admin.
export default function AdminPage() {
  return <AdminApp />;
}
