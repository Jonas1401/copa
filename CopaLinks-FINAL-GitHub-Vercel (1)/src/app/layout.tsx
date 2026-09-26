import type { Metadata, Viewport } from "next";
// Fontes empacotadas localmente: o build não depende de baixar nada do Google.
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";
import { headers } from "next/headers";
import { DESCRICAO_CURTA, IMAGEM_COMPARTILHAR, NOME_APP } from "@/lib/compartilhar";

/**
 * Metadados com endereço absoluto (o link de pré-visualização muda): assim a
 * prévia no WhatsApp mostra a imagem, o título e a descrição do app.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  // Detecta o domínio automaticamente (seja o domínio gerado pela Vercel, localhost ou domínio customizado)
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "localhost:3000");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const protocolo = local ? "http" : "https";
  const urlFinal =
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `${protocolo}://${host}`);
  const base = new URL(urlFinal.startsWith("http") ? urlFinal : `https://${urlFinal}`);
  return {
    ...metadataBase,
    metadataBase: base,
    alternates: { canonical: base.toString().replace(/\/$/, "") },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: NOME_APP,
      title: NOME_APP,
      description: DESCRICAO_CURTA,
      url: base,
      images: [{ url: IMAGEM_COMPARTILHAR, width: 1200, height: 630, alt: NOME_APP }],
    },
    twitter: {
      card: "summary_large_image",
      title: NOME_APP,
      description: DESCRICAO_CURTA,
      images: [IMAGEM_COMPARTILHAR],
    },
  };
}

const metadataBase: Metadata = {
  title: "Monitor Ponto CopaLinks · MONITORANDO",
  description: DESCRICAO_CURTA,
  applicationName: "Monitor Ponto CopaLinks",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/copalinks-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/copalinks-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/copalinks-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/copalinks-apple-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: [{ url: "/icons/copalinks-96.png", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "CopaLinks",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#01101e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
