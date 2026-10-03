export type NexaOrderStatus =
  | "CRIADO_NA_NEXA"
  | "AGUARDANDO_NEXA"
  | "PROVISIONING"
  | "AGUARDANDO_ESIM"
  | "CONCLUIDO"
  | "PROVISIONING_FAILED"
  | "CANCELLED_BY_NEXA"
  | "STATUS_NEXA_NAO_MAPEADO";

export function mapearStatusInternoNexa(providerStatusCode: number | null, hasInstallData: boolean): NexaOrderStatus {
  if (providerStatusCode === 6) return hasInstallData ? "CONCLUIDO" : "AGUARDANDO_ESIM";
  if (providerStatusCode === 12 || providerStatusCode === 4) return "PROVISIONING_FAILED";
  if (providerStatusCode === 11 || providerStatusCode === 5) return "CANCELLED_BY_NEXA";
  if (providerStatusCode === 2) return "AGUARDANDO_NEXA";
  if (providerStatusCode === 1) return "CRIADO_NA_NEXA";
  if (providerStatusCode === 3) return "PROVISIONING";
  return "STATUS_NEXA_NAO_MAPEADO";
}

/**
 * Provider callbacks and administrative queries may be delivered out of order.
 * Do not let stale states undo completion, cancellation, refunds, or a newer
 * in-progress retry. The provider's numeric values are not treated as a simple
 * sequence: only the documented early states 1/2/3 are monotone.
 */
export function reconciliarStatusNexa(options: {
  currentStatus: string;
  currentProviderStatusCode: number | null;
  incomingProviderStatusCode: number | null;
  hasInstallData: boolean;
}) {
  const { currentStatus, currentProviderStatusCode, incomingProviderStatusCode, hasInstallData } = options;
  if (incomingProviderStatusCode == null) {
    return { status: currentStatus, providerStatusCode: currentProviderStatusCode };
  }

  if (["REFUNDED", "PAID_TEST_SIMULATED", "CANCELLED_BY_NEXA"].includes(currentStatus)) {
    return { status: currentStatus, providerStatusCode: currentProviderStatusCode };
  }
  if (currentStatus === "CONCLUIDO") {
    return { status: currentStatus, providerStatusCode: currentProviderStatusCode ?? 6 };
  }
  if (currentProviderStatusCode === 6 && incomingProviderStatusCode !== 6) {
    return {
      status: hasInstallData ? "CONCLUIDO" : "AGUARDANDO_ESIM",
      providerStatusCode: 6,
    };
  }
  if (
    (currentProviderStatusCode === 5 || currentProviderStatusCode === 11) &&
    incomingProviderStatusCode !== 5 && incomingProviderStatusCode !== 11
  ) {
    return { status: "CANCELLED_BY_NEXA", providerStatusCode: currentProviderStatusCode };
  }
  if (
    currentStatus === "PROVISIONING_FAILED" &&
    (currentProviderStatusCode === 4 || currentProviderStatusCode === 12) &&
    incomingProviderStatusCode !== 4 && incomingProviderStatusCode !== 12
  ) {
    return { status: currentStatus, providerStatusCode: currentProviderStatusCode };
  }
  if (
    currentProviderStatusCode != null && [1, 2, 3].includes(currentProviderStatusCode) &&
    [1, 2, 3].includes(incomingProviderStatusCode) &&
    incomingProviderStatusCode < currentProviderStatusCode
  ) {
    return { status: currentStatus, providerStatusCode: currentProviderStatusCode };
  }

  return {
    status: mapearStatusInternoNexa(incomingProviderStatusCode, hasInstallData),
    providerStatusCode: incomingProviderStatusCode,
  };
}
