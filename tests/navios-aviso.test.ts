import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  bercoFonteDefinido, LeituraNaviosInvalida, manobraPodeAvisar,
  novidadesAtracados, novidadesManobras, parseAtracadosComposio,
  parseManobrasComposio, saldoEmToneladas,
} from "../src/lib/navios-fontes";
import { mensagemVisivelNoChat, NOME_NAVIOS_AUTOMACAO, POLITICA_AUTOMACAO, sistemaPodePublicar } from "../src/lib/politica-automacao";
import { atracadosTexto, manobrasTexto } from "./navios-composio-fixture";
import type { Previsao } from "../src/lib/tempo";

const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try { const u = new URL(uri); return ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname.startsWith("/fila_push_test_"); } catch { return false; }
})();

test("Composio: preserva nomes, operadoras, berço e todos os decimais da fonte", () => {
  const n = parseAtracadosComposio(atracadosTexto());
  assert.equal(n.length, 3);
  assert.deepEqual(n.map((x) => [x.nome, x.berco]), [["AFFINITY DIVA", "FOSPAR"], ["ARISTOS II", "Berço 211"], ["ECO CERBERUS", "Berço 208"]]);
  assert.equal(n[1].saldoTotal, "41.792,880 Tons.");
  assert.equal(n[2].saldoToneladas, 544.19);
  assert.equal(n[2].operadoras.length, 2);
  assert.equal(n[2].operadoras[0].saldo, "319,630 Tons.");
  assert.match(n[2].texto, /Saldo Total do Navio 544,190 Tons\./);
  assert.doesNotMatch(n[2].texto, /cerca|arredond|bora|maré|preamar/i);
});

test("Composio: Markdown/HTML e rótulo separado do valor não alteram o saldo", () => {
  const bruto = atracadosTexto().replaceAll("Saldo da Operadora", "**Saldo da Operadora**\n").replaceAll("Saldo Total do Navio", "**Saldo Total do Navio**\n").replace("ECO CERBERUS", "### ECO CERBERUS");
  const n = parseAtracadosComposio(bruto);
  assert.equal(n[2].saldoTotal, "544,190 Tons.");
  assert.equal(n[2].operadoras[1].saldo, "224,560 Tons.");
  const html = atracadosTexto().split("\n").map((l) => `<p>${l}</p>`).join("");
  assert.equal(parseAtracadosComposio(html)[2].saldoToneladas, 544.19);
});

test("Composio: operadora FOSPAR não troca o berço do próximo cartão", () => {
  const bruto = `PARANAGUÁ\nBerço 211\n1 operadora\nNAVIO A\nFOSPAR\nUREIA\nSaldo da Operadora 100,000 Tons.\nSaldo Total do Navio 100,000 Tons.\n1 operadora\nNAVIO B\nFOSPAR\nUREIA\nSaldo da Operadora 90,000 Tons.\nSaldo Total do Navio 90,000 Tons.`;
  assert.equal(parseAtracadosComposio(bruto)[1].berco, "Berço 211");
});

test("Composio: leitura parcial, duplicada ou saldo inválido não vira estado novo", () => {
  for (const b of [
    "<html><div id=\"root\"></div></html>",
    atracadosTexto().replace("Saldo Total do Navio544,190 Tons.", ""),
    atracadosTexto().replace("Saldo da Operadora224,560 Tons.", ""),
    atracadosTexto().replace("544,190 Tons.", "não informado"),
    atracadosTexto() + "\nSaldo Total do Navio 10,000 Tons.",
  ]) assert.throws(() => parseAtracadosComposio(b), LeituraNaviosInvalida);
  assert.throws(() => parseAtracadosComposio(atracadosTexto().replace("ECO CERBERUS", "ARISTOS II")), /duplicado/);
});

test("saldo: limite estrito de 2.000 t e interpretação brasileira sem arredondar", () => {
  assert.equal(saldoEmToneladas("1.999,999 Tons."), 1999.999);
  assert.equal(saldoEmToneladas("2.000,000 Tons."), 2000);
  assert.equal(saldoEmToneladas("0,000 Tons."), 0);
  for (const v of ["-1,000 Tons.", "1.9999 Tons.", "20 Movs.", "?", "NaN", "2000"]) assert.equal(saldoEmToneladas(v), null);
  const base = parseAtracadosComposio(atracadosTexto({ eco: "2.100,000" }));
  assert.equal(novidadesAtracados(base, parseAtracadosComposio(atracadosTexto({ eco: "2.000,000" }))).length, 0);
  assert.equal(novidadesAtracados(base, parseAtracadosComposio(atracadosTexto({ eco: "1.999,999" })))[0].tipo, "saldo");
  // Saldo de uma operadora abaixo do limite não basta com navio grande.
  assert.equal(novidadesAtracados(base, parseAtracadosComposio(atracadosTexto({ eco: "2.100,000", outro: "10,000" }))).length, 0);
});

test("saldo: toda mudança observada abaixo do limite, sem repetir nem agrupar navios", () => {
  const a = parseAtracadosComposio(atracadosTexto({ aristos: "1.900,000" }));
  const b = parseAtracadosComposio(atracadosTexto({ eco: "500,123", aristos: "1.899,999" }));
  const ev = novidadesAtracados(a, b);
  assert.equal(ev.length, 2);
  assert.match(ev[0].texto, /ARISTOS II/); assert.doesNotMatch(ev[0].texto, /ECO CERBERUS/);
  assert.match(ev[1].texto, /ECO CERBERUS/); assert.doesNotMatch(ev[1].texto, /ARISTOS II/);
  assert.equal(novidadesAtracados(b, b).length, 0);
  assert.equal(novidadesAtracados(b, parseAtracadosComposio(atracadosTexto({ eco: "500,123", aristos: "1.899,999", outro: "318,630" }))).length, 1, "mudou saldo da operadora e total continua abaixo de 2000");
  assert.equal(novidadesAtracados(a, []).length, 0, "desaparecimento não prova desatracação");
});

test("manobras: data e situação literais; EF não é atracação com berço", () => {
  const m = parseManobrasComposio(manobrasTexto());
  assert.equal(m.length, 4);
  assert.equal(m[0].berco, "PFELIX 2 BB");
  assert.equal(m[3].berco, "FOSPAR EXT BB");
  assert.ok(manobraPodeAvisar(m[0]));
  assert.ok(!manobraPodeAvisar(m[1]));
  assert.deepEqual(novidadesManobras(m, parseManobrasComposio(manobrasTexto({ berco: "AZ211 BB" }))).map((e) => e.navio), ["AFENTIS XRISTOS ATH"]);
  const texto = novidadesManobras(m, parseManobrasComposio(manobrasTexto({ berco: "AZ211 BB" })))[0].texto;
  assert.match(texto, /11\/10 17:00·AT— Atracação: AZ211 BB\nPREVISTA/);
  assert.doesNotMatch(texto, /confirmada|já atracou|já saiu|maré/i);
  assert.equal(novidadesManobras(m, m).length, 0);
  for (const b of ["", "-", "?", "A DEFINIR", "a confirmar", "Fundeio", "SEM BERÇO", "N/A", "ND"]) assert.ok(!bercoFonteDefinido(b), b);
  for (const b of ["211", "AZ1011 BB", "FOSPAR EXT BB", "PFELIX 2 BB"]) assert.ok(bercoFonteDefinido(b), b);
});

test("manobras: sem data/situação, cartão cortado ou data impossível é rejeitado", () => {
  for (const b of [
    manobrasTexto().replace("11/10 17:00", "31/02 17:00"),
    manobrasTexto().replace("11/10 17:00", "11/10 25:00"),
    manobrasTexto().replace("11/10 17:00·EF— Entrada e Fundeio\nPREVISTA", ""),
    manobrasTexto().replace("14/10 18:00·DS— Desatracação e Saída: FOSPAR EXT BB\nPREVISTA", "14/10 18:00·DS— Desatracação e Saída: FOSPAR EXT BB"),
  ]) assert.throws(() => parseManobrasComposio(b), LeituraNaviosInvalida);
});

test("política: somente navios automáticos; motoristas e perguntas à IA preservados", () => {
  assert.equal(POLITICA_AUTOMACAO.limiteSaldoToneladas, 2000);
  for (const nome of ["🌦️ Clima no Porto", "🌤️ Previsão do Porto", "📡 Radar da Previsão", "👋 CopaLinks", "Dicas do Porto"]) {
    assert.ok(!sistemaPodePublicar(nome)); assert.ok(!mensagemVisivelNoChat({ motoristaId: 0, nome }));
    assert.ok(mensagemVisivelNoChat({ motoristaId: 12, nome }));
  }
  assert.ok(sistemaPodePublicar(NOME_NAVIOS_AUTOMACAO));
});

/** Integração real somente com PostgreSQL local DESCARTÁVEL e Push/fetch falsos.
 * DATABASE_URL=TEST_DATABASE_URL=.../fila_push_test_<nome> tsx --test ...
 * Nenhum serviço externo recebe chamadas ou mensagens durante os testes.
 */
test("backend: Composio → comparação persistente → um navio por chat/Push → retentativa", { skip: !local }, async (t) => {
  const { db } = await import("../src/db");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { garantirTabelasNavios } = await import("../src/lib/navios-migracao");
  const { verificarNaviosComposio } = await import("../src/lib/navios-monitor");
  const { chatMensagens, configuracao, motoristas, subscriptions, naviosMonitorEventos, naviosMonitorFontes, notificacoes, pushEntregas } = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;
  const fetchReal = globalThis.fetch, sendReal = webpush.sendNotification;
  process.env.COMPOSIO_API_KEY = "chave-ficticia-do-teste-sem-rede";
  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  let atracados = atracadosTexto(), manobras = manobrasTexto(), erroAtracados = false;
  let falharEndpoint: string | null = null;
  const leituras: string[] = [], pushes: { endpoint: string; body: string; tag: string }[] = [], prompts: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const url = String(_input);
    assert.ok(url.startsWith("https://backend.composio.dev/"), `nenhuma chamada fora do Composio: ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("GEMINI_GENERATE_CONTENT")) {
      prompts.push(body.arguments.system_instruction + "\n" + body.arguments.prompt);
      return Response.json({ successful: true, data: { text: "Mantenha os faróis acesos ao circular no porto e siga a sinalização vigente." } });
    }
    assert.ok(url.endsWith("COMPOSIO_SEARCH_FETCH_URL_CONTENT"), "avisos não passam por LLM nem clima");
    const fonte: string = body.arguments.urls[0]; leituras.push(fonte);
    if (fonte === POLITICA_AUTOMACAO.fonteAtracados && erroAtracados) return Response.json({ successful: false, error: "falha simulada" });
    const texto = fonte === POLITICA_AUTOMACAO.fonteAtracados ? atracados : manobras;
    return Response.json({ successful: true, data: { results: [{ id: fonte, text: texto }] } });
  };
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async (s: { endpoint: string }, corpo: string) => {
    if (s.endpoint === falharEndpoint) throw Object.assign(new Error("falha temporária"), { statusCode: 503 });
    const p = JSON.parse(corpo); pushes.push({ endpoint: s.endpoint, body: p.body, tag: p.tag });
    return { statusCode: 201, body: "" };
  } });
  try {
    await garantirTabelas(); await garantirTabelasNavios();
    await db.delete(pushEntregas); await db.delete(naviosMonitorEventos); await db.delete(naviosMonitorFontes);
    await db.delete(chatMensagens); await db.delete(notificacoes); await db.delete(subscriptions);
    const [ana, bia, caio] = await db.insert(motoristas).values([{ nome: "Ana monitor" }, { nome: "Bia monitor" }, { nome: "Caio silenciado" }]).returning();
    await db.insert(subscriptions).values([
      { endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: ana.id },
      { endpoint: "https://push.teste/bia", p256dh: "x", auth: "y", motoristaId: bia.id },
      { endpoint: "https://push.teste/caio", p256dh: "x", auth: "y", motoristaId: caio.id },
    ]);
    const { definirSilencioChat } = await import("../src/lib/chat-silencio");
    await definirSilencioChat(caio.id, true);
    const ciclo = () => verificarNaviosComposio({ forcar: true });
    const mensagens = () => db.select().from(chatMensagens).orderBy(chatMensagens.id);

    await t.test("primeira leitura silenciosa de cada fonte, com memória permanente", async () => {
      const r = await ciclo();
      assert.equal(r.eventos, 0); assert.equal(r.avisados.length, 0);
      assert.equal((await mensagens()).length, 0); assert.equal(pushes.length, 0);
      assert.equal((await db.select().from(naviosMonitorFontes)).length, 2);
      assert.equal(leituras.length, 2);
      const config = await db.select().from(configuracao);
      assert.ok(config.some((c) => c.chave === "ia_porto_politica_v2" && c.valor.includes("2.000")));
      assert.ok(config.some((c) => c.chave === "ia_porto_orientacoes_v2" && c.valor.includes("REGRA 11")));
      await ciclo(); assert.equal((await mensagens()).length, 0);
    });

    await t.test("dois navios atualizados dão duas mensagens e dois Push por aparelho", async () => {
      atracados = atracadosTexto({ eco: "500,123", aristos: "1.999,999" });
      const r = await ciclo(); assert.equal(r.eventos, 2); assert.equal(r.avisados.length, 2);
      const msgs = await mensagens(); assert.equal(msgs.length, 2);
      assert.match(msgs[0].texto, /ARISTOS II/); assert.doesNotMatch(msgs[0].texto, /ECO CERBERUS/);
      assert.match(msgs[1].texto, /ECO CERBERUS/); assert.doesNotMatch(msgs[1].texto, /ARISTOS II/);
      assert.match(msgs[1].texto, /500,123 Tons\./);
      assert.equal(pushes.length, 4); assert.ok(pushes.every((p) => p.endpoint !== "https://push.teste/caio"));
      assert.equal(pushes.filter((p) => p.body === msgs[0].texto).length, 2);
      assert.equal(pushes.filter((p) => p.body === msgs[1].texto).length, 2, "payload sem truncar o saldo");
      await ciclo(); assert.equal((await mensagens()).length, 2); assert.equal(pushes.length, 4);
    });

    await t.test("berço definido e mudanças pequenas de horário avisam, sem inferir confirmação", async () => {
      manobras = manobrasTexto({ berco: "AZ211 BB" }); await ciclo();
      let msgs = await mensagens(); assert.equal(msgs.length, 3);
      assert.match(msgs[2].texto, /AFENTIS XRISTOS ATH/); assert.match(msgs[2].texto, /PREVISTA/);
      assert.doesNotMatch(msgs[2].texto, /confirmada|já atracou/i);
      manobras = manobrasTexto({ berco: "AZ211 BB", dataHora: "11/10 17:30" }); await ciclo();
      msgs = await mensagens(); assert.equal(msgs.length, 4); assert.match(msgs[3].texto, /17:30/);
    });

    await t.test("fonte quebrada não altera sua memória nem impede a outra fonte", async () => {
      const [antes] = await db.select().from(naviosMonitorFontes).where(eq(naviosMonitorFontes.fonte, "atracados"));
      erroAtracados = true;
      manobras = manobrasTexto({ berco: "AZ212 BB", dataHora: "11/10 17:30" });
      const r = await ciclo(); assert.equal(r.eventos, 1);
      const [depois] = await db.select().from(naviosMonitorFontes).where(eq(naviosMonitorFontes.fonte, "atracados"));
      assert.equal(depois.dados, antes.dados); assert.equal(depois.lidoEm?.getTime(), antes.lidoEm?.getTime());
      assert.ok(depois.erro); erroAtracados = false;
      atracados = atracadosTexto().replace("Saldo Total do Navio544,190 Tons.", "");
      await ciclo();
      const [parcial] = await db.select().from(naviosMonitorFontes).where(eq(naviosMonitorFontes.fonte, "atracados"));
      assert.equal(parcial.dados, antes.dados, "leitura parcial também preserva o estado");
    });

    await t.test("cron concorrente não duplica, e 2.000 exatas não recebem alerta de saldo", async () => {
      const numeroAntes = (await mensagens()).length;
      const pushAntes = pushes.length;
      atracados = atracadosTexto({ eco: "499,123", aristos: "2.000,000" });
      await Promise.all([ciclo(), ciclo()]);
      assert.equal((await mensagens()).length, numeroAntes + 1);
      assert.equal(pushes.length, pushAntes + 2);
    });

    await t.test("falha temporária em Bia retenta só Bia, sem duplicar chat ou Ana", async () => {
      const chatAntes = (await mensagens()).length, pushAntes = pushes.length;
      falharEndpoint = "https://push.teste/bia";
      atracados = atracadosTexto({ eco: "498,987", aristos: "2.000,000" });
      await ciclo(); assert.equal((await mensagens()).length, chatAntes + 1); assert.equal(pushes.length, pushAntes + 1);
      const [pendente] = await db.select().from(naviosMonitorEventos).where(sql`${naviosMonitorEventos.pushEm} is null`);
      assert.ok(pendente); assert.ok(pendente.mensagemId); assert.equal(pendente.tentativas, 1);
      await db.update(naviosMonitorEventos).set({ envioAte: null }).where(eq(naviosMonitorEventos.id, pendente.id));
      falharEndpoint = null; await ciclo();
      assert.equal((await mensagens()).length, chatAntes + 1); assert.equal(pushes.length, pushAntes + 2);
      const [concluido] = await db.select().from(naviosMonitorEventos).where(eq(naviosMonitorEventos.id, pendente.id));
      assert.ok(concluido.pushEm); assert.equal(concluido.tentativas, 2);
      assert.equal(pushes.slice(pushAntes).filter((p) => p.endpoint === "https://push.teste/ana").length, 1);
    });

    await t.test("volta A→B→A do saldo é uma nova atualização, não uma chave velha", async () => {
      const antes = (await mensagens()).length;
      atracados = atracadosTexto({ eco: "499,123", aristos: "2.000,000" }); await ciclo();
      atracados = atracadosTexto({ eco: "498,987", aristos: "2.000,000" }); await ciclo();
      assert.equal((await mensagens()).length, antes + 2);
    });

    await t.test("clima/orientações/boas-vindas desativados inclusive com forcar; IA mantém memória", async () => {
      const antes = (await mensagens()).length, pushAntes = pushes.length;
      const { verificarEPostarAlertaClima } = await import("../src/lib/clima-alerta");
      const { verificarEPostarBoletimClima } = await import("../src/lib/clima-boletim");
      const { enviarRegrasSeguranca } = await import("../src/lib/regras-seguranca");
      const { publicarBoasVindasMotorista } = await import("../src/lib/boas-vindas-motorista");
      assert.equal((await verificarEPostarAlertaClima({ forcar: true })).postou, false);
      assert.equal((await verificarEPostarBoletimClima({ forcar: true })).postou, false);
      assert.equal((await enviarRegrasSeguranca()).enviadas, 0);
      assert.equal((await publicarBoasVindasMotorista({ id: ana.id, nome: "Ana" })).via, "desativada");
      const { perguntarIA } = await import("../src/lib/ia");
      await perguntarIA("Quais as regras de comportamento dentro do porto?", [], ana.id);
      assert.ok(prompts.some((p) => /REGRA 01|faróis/.test(p) && /Não publicar automaticamente/.test(p)));
      assert.equal((await mensagens()).length, antes); assert.equal(pushes.length, pushAntes);
      const { memorizarClima, lerMemoriaClima } = await import("../src/lib/ia-memoria-porto");
      const p = { atualizadoEm: "2026-10-08T18:00:00.000Z", agora: {}, alerta: {}, dias: [], fontes: { simport: false, estacao: true, openMeteo: false, composio: false } } as unknown as Previsao;
      await memorizarClima(p); await memorizarClima({ ...p, atualizadoEm: "2026-10-07T18:00:00.000Z" });
      assert.equal((await lerMemoriaClima())?.atualizadoEm, p.atualizadoEm);
    });

    await t.test("cron autenticado lê e publica navios sem pontos cadastrados, sem clima/regras", async () => {
      const { pontos, eventos } = await import("../src/db/schema");
      await db.delete(pontos);
      await db.insert(eventos).values({ codigo: "TESTE", tipo: "TRUCK", livro: "A", numero: 1, acao: "cadastrou", mensagem: "Inicialização isolada, sem semente de pontos" });
      await db.update(naviosMonitorFontes).set({ tentativaEm: null });
      atracados = atracadosTexto({ eco: "497,111", aristos: "2.000,000" });
      const antes = (await mensagens()).length;
      const { GET } = await import("../src/app/api/cron/route");
      process.env.CRON_SECRET = "segredo-ficticio-local-do-cron";
      const proibido = await GET(new Request("http://localhost/api/cron"));
      assert.equal(proibido.status, 401); assert.equal((await mensagens()).length, antes);
      const r = await GET(new Request("http://localhost/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.rodou, false, "fila pessoal em repouso");
      assert.equal(b.navios.eventos, 1); assert.equal(b.navios.avisados.length, 1);
      assert.equal(b.clima, undefined); assert.equal(b.radar, undefined); assert.equal(b.regras, undefined);
      assert.equal((await mensagens()).length, antes + 1);
    });

    await t.test("histórico, polling e contador ocultam clima do sistema, não mensagens humanas", async () => {
      const [marco] = await db.select({ n: sql<number>`max(id)` }).from(chatMensagens);
      await db.insert(chatMensagens).values([
        { motoristaId: 0, nome: "🌦️ Clima no Porto", texto: "Aviso automático antigo" },
        { motoristaId: 0, nome: "🌤️ Previsão do Porto", texto: "Boletim antigo" },
        { motoristaId: 0, nome: "📡 Radar da Previsão", texto: "Radar antigo" },
        { motoristaId: ana.id, nome: ana.nome, texto: "Alguém sabe se vai chover?" },
      ]);
      const { GET } = await import("../src/app/api/chat/route");
      for (const sufixo of ["", `?depois=${marco.n}`]) {
        const r = await GET(new Request(`http://localhost/api/chat${sufixo}`));
        const b = await r.json();
        assert.ok(b.mensagens.every((m: { motoristaId: number; nome: string }) => mensagemVisivelNoChat(m)));
        assert.ok(b.mensagens.some((m: { texto: string }) => m.texto === "Alguém sabe se vai chover?"));
      }
      const r = await GET(new Request(`http://localhost/api/chat?contar=${marco.n}`));
      assert.equal((await r.json()).novas, 1);
    });
  } finally {
    globalThis.fetch = fetchReal;
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: sendReal });
  }
});

after(async () => { if (local) { const { pool } = await import("../src/db"); await pool.end(); } });
