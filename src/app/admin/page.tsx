import type { Metadata } from "next";
import { headers } from "next/headers";
import AdminApp from "@/components/admin/AdminApp";
import { urlPublicaDoAppTexto } from "@/lib/url-app";

export const metadata: Metadata = {
  title: "Configurações de API · CopaLinks",
  robots: { index: false, follow: false },
};

// O endereço do app depende do host (localhost, Vercel ou domínio fixo).
export const dynamic = "force-dynamic";

async function hostDaRequisicao() {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host");
}

// A tela só mostra dados depois que o servidor confirma a sessão de admin.
export default async function AdminPage() {
  const url = urlPublicaDoAppTexto(await hostDaRequisicao());
  return <AdminApp url={url} />;
}
