import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { esimPlans, esimSettings } from "@/db/schema";
import { chamarNexa, mapearCatalogoNexa, nexaeMode, type NexaPlan } from "@/lib/esim/nexaesim";

const CHAVE_MARGEM = "margin_percent";
const AGORA = () => new Date();

/** Explicitly fictional fixture rows. They are never sent to NexaEsim or presented as live plans. */
export const PLANOS_DEMO: NexaPlan[] = [
  {
    packageId: "TEST-BR-1GB-3D",
    productId: "TEST-BR",
    productCode: "TEST-BR",
    productName: "Brasil · demonstração",
    code: "DEMO-BR-1GB-3D",
    name: "Plano de demonstração · 1 GB / 3 dias",
    wholesalePrice: "0.10",
    retailPrice: "0.15",
    currency: "USD",
    dataAmount: "1",
    dataUnit: "GB",
    durationDays: 3,
  },
  {
    packageId: "TEST-JP-3GB-7D",
    productId: "TEST-JP",
    productCode: "TEST-JP",
    productName: "Japão · demonstração",
    code: "DEMO-JP-3GB-7D",
    name: "Plano de demonstração · 3 GB / 7 dias",
    wholesalePrice: "0.20",
    retailPrice: "0.30",
    currency: "USD",
    dataAmount: "3",
    dataUnit: "GB",
    durationDays: 7,
  },
  {
    packageId: "TEST-GLOBAL-5GB-15D",
    productId: "TEST-GLOBAL",
    productCode: "TEST-GLOBAL",
    productName: "Global · demonstração",
    code: "DEMO-GLOBAL-5GB-15D",
    name: "Plano de demonstração · 5 GB / 15 dias",
    wholesalePrice: "0.35",
    retailPrice: "0.50",
    currency: "USD",
    dataAmount: "5",
    dataUnit: "GB",
    durationDays: 15,
  },
];

export async function obterMargemPercentual() {
  const [linha] = await db.select().from(esimSettings).where(eq(esimSettings.key, CHAVE_MARGEM)).limit(1);
  const value = Number(linha?.value ?? "0");
  return Number.isFinite(value) && value >= 0 && value <= 500 ? value : 0;
}

export async function salvarMargemPercentual(value: number) {
  const formatted = value.toFixed(2);
  await db.insert(esimSettings)
    .values({ key: CHAVE_MARGEM, value: formatted })
    .onConflictDoUpdate({ target: esimSettings.key, set: { value: formatted, atualizadoEm: AGORA() } });
  return Number(formatted);
}

export function calcularPrecoCliente(custo: string, margemPercentual: number) {
  const base = Number(custo);
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(margemPercentual) || margemPercentual < 0) {
    throw new Error("Preço ou margem inválidos.");
  }
  return (Math.round(base * (1 + margemPercentual / 100) * 100) / 100).toFixed(2);
}

function dadosPlano(row: NexaPlan, source: "nexa" | "test-fixture", now: Date) {
  return {
    providerPackageId: row.packageId,
    providerProductId: row.productId,
    providerProductCode: row.productCode,
    providerProductName: row.productName,
    code: row.code,
    name: row.name,
    wholesalePrice: row.wholesalePrice,
    retailReferencePrice: row.retailPrice,
    currency: row.currency,
    dataAmount: row.dataAmount,
    dataUnit: row.dataUnit,
    durationDays: row.durationDays,
    source,
    available: true,
    syncedAt: now,
    atualizadoEm: now,
  };
}

async function salvarPlanos(rows: NexaPlan[], source: "nexa" | "test-fixture") {
  const now = AGORA();
  const validos = rows.map((row) => dadosPlano(row, source, now));
  await db.transaction(async (tx) => {
    for (const values of validos) {
      await tx.insert(esimPlans).values(values).onConflictDoUpdate({
        target: esimPlans.providerPackageId,
        set: {
          providerProductId: values.providerProductId,
          providerProductCode: values.providerProductCode,
          providerProductName: values.providerProductName,
          code: values.code,
          name: values.name,
          wholesalePrice: values.wholesalePrice,
          retailReferencePrice: values.retailReferencePrice,
          currency: values.currency,
          dataAmount: values.dataAmount,
          dataUnit: values.dataUnit,
          durationDays: values.durationDays,
          source: values.source,
          available: true,
          syncedAt: now,
          atualizadoEm: now,
        },
      });
    }
    // Só desativa ausentes depois de uma resposta completa e não vazia do catálogo.
    if (source === "nexa" && validos.length > 0) {
      const ids = validos.map((row) => row.providerPackageId);
      await tx.update(esimPlans)
        .set({ available: false, atualizadoEm: now })
        .where(and(eq(esimPlans.source, "nexa"), notInArray(esimPlans.providerPackageId, ids)));
    }
  });
}

export async function atualizarCatalogo() {
  if (nexaeMode() === "TEST") {
    await salvarPlanos(PLANOS_DEMO, "test-fixture");
    return { source: "test-fixture" as const, count: PLANOS_DEMO.length };
  }
  const { data } = await chamarNexa<unknown>("catalog", {});
  const plans = mapearCatalogoNexa(data);
  if (!plans.length) throw new Error("Catálogo NexaEsim vazio ou sem os campos documentados; nada foi desativado.");
  await salvarPlanos(plans, "nexa");
  return { source: "nexa" as const, count: plans.length };
}
