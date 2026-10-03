import { createHmac, timingSafeEqual } from "node:crypto";

/** NexaEsim assina o corpo UTF-8 exato com HMAC-SHA256 e envia 64 dígitos hex maiúsculos. */
export function verificarAssinaturaHmac(rawBody: string | Buffer, signature: string | null, secret: string | undefined) {
  if (!secret?.trim() || !signature || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const recebida = Buffer.from(signature, "hex");
  const esperada = createHmac("sha256", secret.trim()).update(rawBody).digest();
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

/** Usado por testes e por adaptadores do gateway que assinem o contrato CopaLinks. */
export function assinaturaHmacTeste(rawBody: string | Buffer, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex").toUpperCase();
}
