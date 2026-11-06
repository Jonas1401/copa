#!/usr/bin/env node
/**
 * Proxy TCP que simula o Supavisor (pooler do Supabase) oscilando:
 * recusa as primeiras `--recusas` conexões com erro de autenticação
 * (28P01 "Authentication credentials are invalid...") e depois repassa
 * para o Postgres real em `--alvo` (host:porta).
 *
 * Uso:
 *   node scripts/proxy-oscilante.mjs --alvo=127.0.0.1:55433 --recusas=2
 */
import net from "node:net";

const args = process.argv.slice(2);
const alvo = (args.find((a) => a.startsWith("--alvo=")) ?? "--alvo=127.0.0.1:55433").split("=")[1];
const recusas = Number((args.find((a) => a.startsWith("--recusas=")) ?? "--recusas=2").split("=")[1]);
const [host, port] = alvo.split(":");

let contagem = 0;

function uint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function enviarErroAutenticacao(socket) {
  const msg = "Authentication credentials are invalid. Please reconnect with fresh credentials to restore pool functionality.";
  const corpo = Buffer.concat([
    Buffer.from([0x53]), Buffer.from("FATAL\x00"), // S: severity
    Buffer.from([0x43]), Buffer.from("28P01\x00"), // C: sqlstate
    Buffer.from([0x4d]), Buffer.from(`${msg}\x00`), // M: message
    Buffer.from([0x00]), // fim dos campos
  ]);
  socket.write(Buffer.concat([Buffer.from([0x45]), uint32(corpo.length + 4), corpo]));
  socket.end();
}

/** Lê SSLRequest/StartupMessage antes de decidir recusa/forward. */
function lerPedidoInicial(socket, cb) {
  let buffer = Buffer.alloc(0);
  const timer = setTimeout(() => cb(), 3000);
  socket.on("data", function onData(d) {
    buffer = Buffer.concat([buffer, d]);
    if (buffer.length >= 8) {
      const len = buffer.readUInt32BE(0);
      if (buffer.length >= len) {
        clearTimeout(timer);
        socket.off("data", onData);
        cb();
      }
    }
  });
  socket.once("close", () => {
    clearTimeout(timer);
    cb();
  });
}

const server = net.createServer((socket) => {
  contagem += 1;
  if (contagem <= recusas) {
    lerPedidoInicial(socket, () => {
      console.log(`[proxy] recusando conexão #${contagem} (Supavisor em waiting_for_secrets)`);
      enviarErroAutenticacao(socket);
    });
    return;
  }
  console.log(`[proxy] aceitando conexão #${contagem} → ${host}:${port}`);
  const remoto = net.connect(Number(port), host);
  socket.pipe(remoto);
  remoto.pipe(socket);
  socket.on("error", () => {});
  remoto.on("error", () => {});
});

server.on("error", (e) => {
  console.error("[proxy] erro:", e.message);
  process.exit(1);
});

server.listen(55432, "127.0.0.1", () => {
  console.log(`[proxy] rodando em 127.0.0.1:55432 → ${host}:${port} · recusando as ${recusas} primeiras conexões`);
});
