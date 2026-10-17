import type { Metadata } from "next";
import { headers } from "next/headers";
import DivulgacaoApp from "@/components/divulgacao/DivulgacaoApp";
import { DESCRICAO_CURTA, NOME_APP } from "@/lib/compartilhar";
import { urlPublicaDoApp, urlPublicaDoAppTexto } from "@/lib/url-app";

// O endereço do app depende do host (localhost, Vercel ou domínio fixo).
export const dynamic = "force-dynamic";

async function hostDaRequisicao() {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host");
}

export async function generateMetadata(): Promise<Metadata> {
  const base = urlPublicaDoApp(await hostDaRequisicao());
  const pagina = `${base.toString().replace(/\/$/, "")}/divulgacao`;
  return {
    title: `${NOME_APP} · Instale no celular`,
    description: DESCRICAO_CURTA,
    alternates: { canonical: pagina },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: NOME_APP,
      title: `${NOME_APP} · Instale no celular`,
      description: DESCRICAO_CURTA,
      url: pagina,
      images: [
        { url: "/images/divulgacao-card.jpg", width: 1200, height: 630, alt: NOME_APP },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${NOME_APP} · Instale no celular`,
      description: DESCRICAO_CURTA,
      images: ["/images/divulgacao-card.jpg"],
    },
  };
}

export default async function PaginaDivulgacao() {
  const url = urlPublicaDoAppTexto(await hostDaRequisicao());
  return <DivulgacaoApp url={url} />;
}
