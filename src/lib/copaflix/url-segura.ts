/**
 * Segurança de endereços externos do CopaFlix.
 *
 * Toda fonte autorizada (lista M3U, Jellyfin, EPG) é buscada pelo SERVIDOR.
 * Sem esta checagem, um endereço malicioso configurado por engano poderia
 * fazer o app acessar a rede interna (SSRF). Aqui só passa http/https público,
 * sem usuário/senha embutidos, sem IP privado e sem nome de máquina local.
 */

const HOSTS_BLOQUEADOS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);

const SUFIXOS_BLOQUEADOS = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

export type ResultadoUrl =
  | { ok: true; url: URL }
  | { ok: false; motivo: string };

function ipv4Privado(host: string): boolean {
  const partes = host.split(".");
  if (partes.length !== 4) return false;
  const nums = partes.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (nums[2] === 0 || nums[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Privado(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true;
  }
  // IPv4 mapeado (::ffff:192.168.x.x)
  const mapeado = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Privado(mapeado[1]);
  return false;
}

/**
 * Valida um endereço que o servidor vai buscar.
 * `permitirRedeInterna` só deve ser ligado por quem administra a instalação e
 * sabe que o servidor vive na mesma rede do Jellyfin (variável
 * COPAFLIX_PERMITIR_REDE_INTERNA=1).
 */
export function validarUrlExterna(
  valor: unknown,
  opcoes: { permitirRedeInterna?: boolean } = {},
): ResultadoUrl {
  if (typeof valor !== "string") return { ok: false, motivo: "Endereço ausente." };
  const texto = valor.trim();
  if (!texto) return { ok: false, motivo: "Endereço vazio." };
  if (texto.length > 2048) return { ok: false, motivo: "Endereço longo demais." };
  if (/[\s\u0000-\u001f]/.test(texto)) return { ok: false, motivo: "Endereço com caracteres inválidos." };

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, motivo: "Endereço inválido." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, motivo: "Só http:// e https:// são aceitos." };
  }
  if (!url.hostname) return { ok: false, motivo: "Endereço sem domínio." };
  if (url.username || url.password) {
    return { ok: false, motivo: "Não envie usuário/senha dentro do endereço." };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (HOSTS_BLOQUEADOS.has(host)) return { ok: false, motivo: "Endereço interno bloqueado." };
  if (SUFIXOS_BLOQUEADOS.some((sufixo) => host.endsWith(sufixo))) {
    return { ok: false, motivo: "Endereço interno bloqueado." };
  }

  const ehIp = host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (ehIp) {
    const privado = host.includes(":") ? ipv6Privado(host) : ipv4Privado(host);
    if (privado && !opcoes.permitirRedeInterna) {
      return { ok: false, motivo: "IP privado bloqueado." };
    }
  }

  return { ok: true, url };
}

/** Versão booleana curta, para validar cada linha de uma lista. */
export function urlExternaSegura(valor: unknown, permitirRedeInterna = false) {
  return validarUrlExterna(valor, { permitirRedeInterna }).ok;
}

/**
 * A mesma origem? Usado para nunca aceitar um "redirecionamento" que troque
 * de domínio no meio do caminho (a checagem é feita de novo no fetch).
 */
export function mesmaOrigem(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
