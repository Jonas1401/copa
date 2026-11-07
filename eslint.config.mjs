import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // Arquivos de declaração são só tipos: o parser de JS do ESLint não os entende.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "**/*.d.ts", "**/*.d.mts"]),
]);
