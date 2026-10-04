import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PISO_URGENTE_MIN,
  POLITICAS_PADRAO,
  avaliarCota,
  diaLocal,
  horaLocal,
  politica,
  type Politica,
  type Registro,
} from "../src/lib/notificacoes-cota";

/**
 * COTA DE NOTIFICAÇÕES — o antiexcesso comum aos agentes do chat.
 *
 * Testes puros (sem banco e sem rede): as decisões de intervalo mínimo, teto
 * por hora, teto por dia e a passagem do aviso URGENTE são todas calculadas em
 * `avaliarCota`, com o dia e a hora de Brasília.
 */

/** Registro de um aviso publicado há `min` minutos, no dia/hora de `agora`. */
function registro(min: number, agora: Date, extras: Partial<Registro> = {}): Registro {
  return {
    em: agora.getTime() - min * 60_000,
    hora: { chave: horaLocal(agora), n: 1 },
    dia: { chave: diaLocal(agora), n: 1 },
    ...extras,
  };
}

const RADAR: Politica = { intervaloMin: 45, maxHora: 2, maxDia: 8 };

test("cota: padrões de fábrica e variáveis de ambiente", () => {
  const p = politica("radar", {} as Record<string, string>);
  assert.deepEqual(p, POLITICAS_PADRAO.radar);
  assert.deepEqual(p, { intervaloMin: 45, maxHora: 2, maxDia: 8 });

  // Alerta de clima: lembrete de 6 em 6 h, no máximo 4 por dia.
  assert.deepEqual(politica("clima", {} as Record<string, string>), { intervaloMin: 360, maxHora: 1, maxDia: 4 });
  // Navios: 20 min entre avisos, 3 por hora, 8 por dia.
  assert.deepEqual(politica("navios", {} as Record<string, string>), { intervaloMin: 20, maxHora: 3, maxDia: 8 });

  // Variáveis de ambiente mandam; valor inválido (zero/negativo) cai no padrão.
  const ajustada = politica("radar", {
    CLIMA_MONITOR_AVISO_MIN: "60",
    CLIMA_MONITOR_MAX_HORA: "1",
    CLIMA_MONITOR_MAX_DIA: "5",
  } as Record<string, string>);
  assert.deepEqual(ajustada, { intervaloMin: 60, maxHora: 1, maxDia: 5 });
  assert.equal(politica("radar", { CLIMA_MONITOR_AVISO_MIN: "0" } as Record<string, string>).intervaloMin, 45);
});

test("cota: sem registro, o aviso passa", () => {
  const agora = new Date("2026-10-04T14:00:00Z");
  assert.deepEqual(avaliarCota(null, RADAR, agora), { liberado: true, motivo: "" });
});

test("cota: intervalo mínimo entre dois avisos do mesmo assunto", () => {
  const agora = new Date("2026-10-04T14:00:00Z");
  const bloqueado = avaliarCota(registro(30, agora), RADAR, agora);
  assert.equal(bloqueado.liberado, false);
  assert.match(bloqueado.motivo, /aguardando 15 min/);

  assert.equal(avaliarCota(registro(45, agora), RADAR, agora).liberado, true);
  assert.equal(avaliarCota(registro(120, agora), RADAR, agora).liberado, true);
});

test("cota: teto por hora e teto por dia, no horário de Brasília", () => {
  const agora = new Date("2026-10-04T14:00:00Z"); // 11h em Brasília
  assert.equal(diaLocal(agora), "2026-10-04");
  assert.equal(horaLocal(agora), "2026-10-04T11");

  const hora = avaliarCota(
    registro(60, agora, { hora: { chave: "2026-10-04T11", n: 2 } }),
    RADAR,
    agora,
  );
  assert.equal(hora.liberado, false);
  assert.match(hora.motivo, /limite de 2 avisos por hora/);

  const dia = avaliarCota(
    registro(60, agora, { hora: { chave: "2026-10-04T11", n: 1 }, dia: { chave: "2026-10-04", n: 8 } }),
    RADAR,
    agora,
  );
  assert.equal(dia.liberado, false);
  assert.match(dia.motivo, /limite de 8 avisos por dia/);

  // Virou a hora (e o dia): os contadores antigos não bloqueiam mais.
  const outraHora = avaliarCota(
    registro(60, agora, { hora: { chave: "2026-10-04T10", n: 2 }, dia: { chave: "2026-10-03", n: 8 } }),
    RADAR,
    agora,
  );
  assert.equal(outraHora.liberado, true);
});

test("cota: aviso urgente passa do teto, com piso curto entre avisos", () => {
  const agora = new Date("2026-10-04T14:00:00Z");
  // Aviso urgente logo depois do anterior: espera o piso de 15 min.
  const colado = avaliarCota(registro(10, agora), RADAR, agora, true);
  assert.equal(colado.liberado, false);
  assert.match(colado.motivo, new RegExp(`aguardando ${PISO_URGENTE_MIN - 10} min`));

  // Passado o piso, o teto de hora/dia NÃO segura o urgente…
  const cheio = registro(20, agora, {
    hora: { chave: "2026-10-04T11", n: 2 },
    dia: { chave: "2026-10-04", n: 8 },
  });
  assert.equal(avaliarCota(cheio, RADAR, agora, true).liberado, true);

  // …mas o teto diário dobrado continua sendo a trava de segurança.
  const estourou = avaliarCota(
    registro(20, agora, { dia: { chave: "2026-10-04", n: 16 } }),
    RADAR,
    agora,
    true,
  );
  assert.equal(estourou.liberado, false);
  assert.match(estourou.motivo, /limite de 16 avisos no dia/);

  // O piso do urgente é configurável (ex.: CLIMA_MONITOR_MIN_GRAVE=30)…
  assert.equal(avaliarCota(registro(20, agora), RADAR, agora, true, 30).liberado, false);
  assert.equal(avaliarCota(registro(31, agora), RADAR, agora, true, 30).liberado, true);
  // …mas nunca ultrapassa o intervalo mínimo do próprio assunto (45 min).
  assert.equal(avaliarCota(registro(31, agora), RADAR, agora, true, 90).liberado, false);
  assert.equal(avaliarCota(registro(46, agora), RADAR, agora, true, 90).liberado, true);
});
