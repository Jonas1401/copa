import assert from "node:assert/strict";
import { test } from "node:test";
import {
  endpointsDoHtml,
  esperarConteudo,
  extrairCamposSoltos,
  extrairJsonEmbutido,
  extrairTextoDeHtml,
  gravidadeDoPainel,
  lerPainelAppa,
  normalizarPainelAppa,
  painelDeJson,
  parsearPainelLivre,
  parsearPainelSimport,
  resumoDasTentativas,
  temDadosPainel,
  type NavegadorAppa,
  type OpcoesLeituraAppa,
} from "../src/lib/appa-painel";
import type { Previsao } from "@/lib/tempo";

/**
 * LEITURA DO PAINEL DA APPA COM FALLBACK AUTOMÁTICO.
 *
 * Testes PUROS: nenhum acessa rede, banco, navegador ou IA — o `fetch`, o
 * navegador headless, o OCR e o Composio são injetados por parâmetro (é para
 * isso que `lerPainelAppa` aceita `buscar`, `abrirNavegador`, `ocr` e
 * `lerComposio`). Rodam sempre, inclusive no CI sem Playwright instalado:
 *
 *   ./node_modules/.bin/tsx --test tests/appa-painel.test.ts
 *
 * O que fica travado aqui:
 *   - a ORDEM dos métodos: api → html → playwright → ocr → composio;
 *   - o fallback automático quando um método falha ou devolve vazio;
 *   - o formato único (`DadosPainelAppa`) devolvido por qualquer método;
 *   - que a página NÃO é considerada vazia antes do carregamento dinâmico;
 *   - que erro só aparece quando TODOS os métodos falham.
 */

/* --------------------------------------------------------------- fixações */

/** Texto do painel no formato que o painel/composio devolve. */
const PAINEL = `## 17°C

Sensação térmica: 18°C

0.0 nós

SSE

90%

Umidade

1016

Pressão

**Sex (02/10)**: Há possibilidade de chuva fraca durante a madrugada. No restante do dia, o céu permanece encoberto, com nova possibilidade de chuva fraca entre o final da tarde e a noite. Aviso de rajadas fortes de vento no porto a partir das 13h.

## Previsões Detalhadas

### Previsão de Chuvas

Hora

Condição

Precipit.

Probabil.

23:00

0.2 mm

72%

13:00

6.4 mm

92%

Próximas 24 horas

### Previsão de Ventos

Hora

Velocidade

Direção

23:00

3 nós

SSW

13:00

28 nós

ENE

Próximas 24 horas

### Dados Oceanográficos

#### Previsão de Marés

Paranaguá

02:001.2mAlta

05:100.5mBaixa

### Fases da Lua

Nascer do Sol

04:54

Pôr do Sol

17:15`;

/** Página com tabelas e rótulos, sem JSON embutido nem endpoint (MÉTODO 2). */
const HTML_SIMPLES = `<!doctype html><html><head><style>.x{color:red}</style>
<script>window.__ruido = true;</script></head><body>
<h1>SIMPORT · Dashboard Meteoceanográfico</h1>
<div>Temperatura 21 °C · Umidade 88% · Pressão 1013 hPa · Vento 14 nós SE</div>
<table><tr><th>Hora</th><th>Precipit.</th><th>Probabil.</th></tr>
<tr><td>14:00</td><td>6.4 mm</td><td>92%</td></tr>
<tr><td>15:00</td><td>0.4 mm</td><td>60%</td></tr></table>
<table><tr><th>Hora</th><th>Velocidade</th><th>Direção</th></tr>
<tr><td>14:00</td><td>22 nós</td><td>SE</td></tr></table>
<p>Alerta de chuva forte e tempestade com rajadas no porto a partir das 14h.</p>
</body></html>`;

/** Página montada por JavaScript: só o esqueleto (nada de dado no HTML). */
const HTML_CASCA = `<!doctype html><html><head><script src="/app.js"></script></head>
<body><div id="root"></div><noscript>Ative o JavaScript.</noscript></body></html>`;

/** Página com JSON embutido — o MÉTODO 1 tem de vencer sem tocar em HTML. */
const HTML_COM_JSON = `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"clima":{"temperatura":21.5,"umidade":88,"pressao":1013,
"previsao":[{"hora":"14:00","chuva_mm":6.4,"probabilidade":92},{"hora":"15:00","precipitacao":0.4,"chance":60}],
"vento":[{"hora":"14:00","wind_speed":12,"direcao":"SE"}],
"alerta":"Chuva forte prevista para a tarde no porto"}}}
</script><p>Carregando…</p></body></html>`;

/** Previsão "desligada": a API estruturada não entra no caminho dos testes. */
function previsaoSemApi(): Previsao {
  return {
    cidade: "Paranaguá",
    uf: "PR",
    agora: {
      temperatura: 0,
      sensacao: 0,
      umidade: 0,
      chanceChuva: 0,
      ventoKmh: 0,
      rajadaKmh: 0,
      ventoDirecao: "N",
      ventoGraus: 0,
      chuva24h: null,
      icone: "nuvem",
      descricao: "Nublado",
      hora: "00:00",
      fonte: "previsao",
    },
    alerta: { nivel: "tempo-bom", titulo: "Tempo firme", texto: "Sem chuva prevista." },
    boletim: [],
    horas: [],
    dias: [],
    nascerSol: null,
    porSol: null,
    atualizadoEm: new Date().toISOString(),
    fontes: { simport: false, estacao: false, openMeteo: false, composio: false },
  };
}

/** `fetch` de mentira: mapa de URL → resposta (ou erro). */
function buscaFalsa(mapa: Record<string, { status?: number; corpo?: string } | "erro">): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const achado = Object.entries(mapa).find(([chave]) => url.startsWith(chave));
    if (!achado) return new Response("não encontrado", { status: 404 });
    const [, valor] = achado;
    if (valor === "erro") throw new Error("rede fora");
    return new Response(valor.corpo ?? "", { status: valor.status ?? 200 });
  }) as typeof fetch;
}

/** Navegador headless de mentira (e espião de fechamento). */
function navegadorFalso(opcoes: {
  texto?: string | string[];
  imagem?: Uint8Array;
  erro?: string;
  registro?: string[];
}): (o: { url: string; timeoutMs: number; log: (l: string) => void }) => Promise<NavegadorAppa> {
  return async () => {
    if (opcoes.erro) throw new Error(opcoes.erro);
    const textos = Array.isArray(opcoes.texto) ? [...opcoes.texto] : [opcoes.texto ?? ""];
    return {
      nome: "navegador-teste",
      lerTexto: async () => (textos.length > 1 ? (textos.shift() as string) : textos[0]),
      capturarImagem: async () => opcoes.imagem ?? new Uint8Array(2048),
      fechar: async () => {
        opcoes.registro?.push("fechado");
      },
    };
  };
}

/** Opções padrão: nada de rede de verdade, navegador desligado por padrão. */
function opcoesBase(extra: Partial<OpcoesLeituraAppa>): OpcoesLeituraAppa {
  return {
    previsao: previsaoSemApi(),
    buscar: buscaFalsa({}),
    abrirNavegador: null,
    ocr: async () => {
      throw new Error("OCR não configurado no teste");
    },
    lerComposio: async () => {
      throw new Error("Composio não configurado no teste");
    },
    log: () => {},
    ...extra,
  };
}

/* ---------------------------------------------------- HTML → texto e JSON */

test("painel: HTML vira texto (sem script/estilo, uma célula de tabela por linha)", () => {
  const texto = extrairTextoDeHtml(HTML_SIMPLES);
  assert.ok(!/color:red/.test(texto), "estilo fora do texto");
  assert.ok(!/__ruido/.test(texto), "script fora do texto");
  assert.match(texto, /Temperatura 21 °C/);
  assert.match(texto, /\n14:00\n/);
  assert.match(texto, /6.4 mm/);
  assert.equal(extrairTextoDeHtml(""), "");
});

test("painel: encontra JSON embutido e endpoints internos da página", () => {
  const jsons = extrairJsonEmbutido(HTML_COM_JSON);
  assert.equal(jsons.length, 1, "um bloco JSON");

  const eps = endpointsDoHtml(
    `<script>fetch("/api/forecast.json"); fetch("https://outro.com/api/x"); fetch("/api/v2/tempo")</script>`,
    "https://weather-appa.app.simport.com.br/",
  );
  assert.deepEqual(eps.sort(), [
    "https://weather-appa.app.simport.com.br/api/forecast.json",
    "https://weather-appa.app.simport.com.br/api/v2/tempo",
  ]);
  assert.deepEqual(endpointsDoHtml("<html>sem nada</html>"), []);
});

test("painel: JSON de qualquer formato vira o mesmo painel (só faixas plausíveis)", () => {
  const p = painelDeJson(JSON.parse(
    JSON.stringify({
      temperatura: 21.5,
      umidade: 88,
      pressao: 1013,
      previsao: [{ hora: "14:00", chuva_mm: 6.4, probabilidade: 92 }],
      vento: [{ hora: "14:00", wind_speed: 12, direcao: "SE" }],
      alerta: "Chuva forte prevista para a tarde no porto",
    }),
  ));
  assert.ok(p);
  assert.equal(p.agora.temperatura, 21.5);
  assert.equal(p.agora.umidade, 88);
  assert.equal(p.agora.pressao, 1013);
  assert.equal(p.chuva.length, 1);
  assert.equal(p.chuva[0].mm, 6.4);
  assert.equal(p.vento.length, 1);
  assert.equal(p.vento[0].nos, 12);
  assert.ok((p.alertas ?? []).length >= 1);

  // Número absurdo não vira previsão (temperatura de 900 °C, umidade 400%).
  const lixo = painelDeJson({ temperatura: 900, umidade: 400, pressao: 12 });
  assert.equal(lixo, null, "JSON sem dado plausível não vira painel");
});

test("painel: parser do painel completo continua lendo tabelas, marés e sol", () => {
  const p = parsearPainelSimport(PAINEL);
  assert.ok(p);
  assert.equal(p.agora.temperatura, 17);
  assert.equal(p.agora.umidade, 90);
  assert.equal(p.agora.pressao, 1016);
  assert.equal(p.chuva.length, 2);
  assert.equal(p.chuva[1].mm, 6.4);
  assert.equal(p.vento[1].nos, 28);
  assert.equal(p.mares.length, 2);
  assert.equal(p.nascerSol, "04:54");
  assert.ok((p.alertas ?? []).some((a) => /rajadas fortes/i.test(a)), "alerta do boletim");
  assert.equal(parsearPainelSimport(""), null);
  assert.equal(parsearPainelSimport("erro 500"), null);
});

test("painel: leitura tolerante cobre HTML parcial, OCR e rótulos soltos", () => {
  const livre = parsearPainelLivre(extrairTextoDeHtml(HTML_SIMPLES));
  assert.ok(livre);
  assert.equal(livre.agora.temperatura, 21);
  assert.equal(livre.agora.umidade, 88);
  assert.equal(livre.agora.pressao, 1013);
  assert.equal(livre.agora.ventoNos, 14);
  assert.equal(livre.chuva.length, 2);
  assert.equal(livre.vento.length, 1, "tabela de vento mantida");
  assert.ok((livre.alertas ?? []).length >= 1, "alerta identificado");

  // Texto de OCR: rótulos quebrados, sem tabela.
  const doOcr = parsearPainelLivre("Temperatura 19°C\nUmidade: 91 %\nPressao 1015\nVento 18 nos SSE");
  assert.ok(doOcr);
  assert.equal(doOcr.agora.temperatura, 19);
  assert.equal(doOcr.agora.umidade, 91);
  assert.equal(doOcr.agora.ventoNos, 18);

  assert.equal(parsearPainelLivre("nada aqui"), null);
  assert.equal(extrairCamposSoltos(""), null);
  assert.equal(temDadosPainel(null), false);
  assert.equal(temDadosPainel(livre), true);
});

/* --------------------------------------------------- formato único (JSON) */

test("painel: normalização devolve o formato único que o app consome", () => {
  const p = parsearPainelSimport(PAINEL);
  const d = normalizarPainelAppa(p, { metodo: "html", agora: Date.UTC(2026, 9, 3, 12), textoBruto: PAINEL });
  assert.equal(d.fonte, "APPA");
  assert.equal(d.status, "sucesso");
  assert.equal(d.metodo_leitura, "html");
  assert.equal(d.timestamp_leitura, new Date(Date.UTC(2026, 9, 3, 12)).toISOString());
  assert.match(d.temperatura, /17 °C/);
  assert.match(d.chuva, /92%/);
  assert.match(d.chuva_forte, /6,4 mm/);
  assert.match(d.tempestade, /sem tempestade|risco/);
  assert.match(d.vento, /28 nós/);
  assert.equal(d.umidade, "90%");
  assert.equal(d.pressao, "1016 hPa");
  assert.equal(d.numeros.chuva_mm_24h, 6.6);
  assert.equal(d.numeros.gravidade, 6, "chuva forte no painel");
  assert.ok(d.previsao.length >= 4);
  assert.ok(d.alertas.length >= 1);
  assert.ok(gravidadeDoPainel(p!, p!.alertas ?? []) >= 6);

  // Sem leitura: tudo "não informado" e status falha (nunca um objeto vazio).
  const falha = normalizarPainelAppa(null, { metodo: null });
  assert.equal(falha.status, "falha");
  assert.equal(falha.metodo_leitura, null);
  assert.equal(falha.temperatura, "não informado");
  assert.equal(falha.chuva, "não informado");
  assert.equal(falha.alertas.length, 0);
});

/* ------------------------------------------------- fallback entre métodos */

test("painel: MÉTODO 1 (API/JSON embutido) vence antes de raspar o HTML", async () => {
  const r = await lerPainelAppa(
    opcoesBase({ buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { corpo: HTML_COM_JSON } }) }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.metodo, "api");
  assert.equal(r.normalizado.metodo_leitura, "api");
  assert.match(r.normalizado.chuva_forte, /6,4 mm/);
  assert.equal(r.tentativas.length, 1, "só o primeiro método foi tentado");
  assert.equal(r.tentativas[0].ok, true);
  assert.match(r.tentativas[0].motivo, /ok/);
  assert.match(r.tentativas[0].detalhe ?? "", /JSON embutido/);
});

test("painel: MÉTODO 2 (HTTP + HTML) entra quando não há API/JSON", async () => {
  const r = await lerPainelAppa(
    opcoesBase({ buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { corpo: HTML_SIMPLES } }) }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.metodo, "html");
  assert.equal(r.tentativas.length, 2);
  assert.equal(r.tentativas[0].metodo, "api");
  assert.equal(r.tentativas[0].ok, false);
  assert.equal(r.tentativas[1].metodo, "html");
  assert.equal(r.tentativas[1].ok, true);
  assert.match(r.normalizado.temperatura, /21 °C/);
  assert.match(r.normalizado.tempestade, /tempestade|risco/i);
});

test("painel: casca montada por JavaScript não é aceita como leitura", async () => {
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { corpo: HTML_CASCA } }),
      abrirNavegador: navegadorFalso({ texto: PAINEL }),
    }),
  );
  assert.equal(r.metodo, "playwright", "página vazia no HTML → navegador headless");
  assert.equal(r.tentativas[1].ok, false);
  assert.match(r.tentativas[1].motivo, /JavaScript|pouquíssimo texto|resposta curta|sem dados/i);
  assert.match(r.normalizado.vento, /28 nós/);
});

test("painel: MÉTODO 3 (navegador headless) lê o texto renderizado", async () => {
  const registro: string[] = [];
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": "erro" }),
      abrirNavegador: navegadorFalso({ texto: PAINEL, registro }),
    }),
  );
  assert.equal(r.metodo, "playwright");
  assert.deepEqual(registro, ["fechado"], "o navegador sempre é fechado");
  assert.deepEqual(
    r.tentativas.map((t) => t.metodo),
    ["api", "html", "playwright"],
  );
  assert.equal(r.ok, true);
  assert.match(r.normalizado.chuva, /chuva prevista/i);
});

test("painel: MÉTODO 4 (captura de tela + OCR) quando o DOM não tem texto", async () => {
  const registro: string[] = [];
  const textoOcr = "SIMPORT APPA\nTemperatura 18°C\nUmidade 93 %\nPressao 1010\nVento 24 nos SE\nAlerta de tempestade com rajadas no porto";
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { corpo: HTML_CASCA } }),
      abrirNavegador: navegadorFalso({ texto: "  ", registro }),
      ocr: async (imagem) => {
        assert.ok(imagem.byteLength > 1000, "captura de tela recebida pelo OCR");
        return textoOcr;
      },
    }),
  );
  assert.equal(r.metodo, "ocr");
  assert.equal(r.tentativas[2].metodo, "playwright");
  assert.equal(r.tentativas[2].ok, false);
  assert.equal(r.tentativas[3].metodo, "ocr");
  assert.equal(r.tentativas[3].ok, true);
  assert.equal(r.normalizado.umidade, "93%");
  assert.match(r.normalizado.tempestade, /tempestade/i);
  assert.deepEqual(registro, ["fechado"]);
});

test("painel: MÉTODO 5 (Composio) é o último recurso e nunca o único", async () => {
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { status: 503 } }),
      abrirNavegador: navegadorFalso({ erro: "nenhum navegador headless instalado" }),
      ocr: async () => {
        throw new Error("OCR indisponível");
      },
      lerComposio: async () => PAINEL,
    }),
  );
  assert.equal(r.metodo, "composio");
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.tentativas.map((t) => [t.metodo, t.ok]),
    [
      ["api", false],
      ["html", false],
      ["playwright", false],
      ["ocr", false],
      ["composio", true],
    ],
  );
  assert.match(r.normalizado.pressao, /1016/);
});

test("painel: Composio vazio NÃO é falha definitiva (o radar não para)", async () => {
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({
        "https://weather-appa.app.simport.com.br": { corpo: HTML_COM_JSON },
      }),
      lerComposio: async () => {
        throw new Error("Composio não devolveu texto das páginas (results vazio).");
      },
    }),
  );
  assert.equal(r.ok, true, "o radar continua com o método que funcionou");
  assert.equal(r.metodo, "api");
  assert.equal(r.erro, null);
});

test("painel: erro detalhado SÓ quando todos os métodos falham", async () => {
  const logs: string[] = [];
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { status: 503 } }),
      abrirNavegador: navegadorFalso({ erro: "nenhum navegador headless instalado (playwright ausente)" }),
      ocr: async () => {
        throw new Error("OCR indisponível");
      },
      lerComposio: async () => "",
      log: (l) => logs.push(l),
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.metodo, null);
  assert.equal(r.painel, null);
  assert.equal(r.normalizado.status, "falha");
  assert.equal(r.tentativas.length, 5);
  assert.ok(r.erro && /todos os 5 métodos falharam/.test(r.erro));
  assert.match(r.erro, /API\/endpoint/);
  assert.match(r.erro, /OCR/);
  assert.match(r.erro, /Composio/);
  assert.equal(logs.length >= 5, true, "cada tentativa tem a sua linha de log");
  assert.match(logs[0], /\[radar-appa(?: [^\]]+)?\] método 1\/5/);
  assert.match(resumoDasTentativas(r.tentativas), /sem leitura/);
});

test("painel: a página não é considerada vazia antes do carregamento dinâmico", async () => {
  // O leitor devolve vazio nas primeiras tentativas e só depois o conteúdo:
  // `esperarConteudo` precisa insistir (é assim que o painel real se comporta).
  let chamadas = 0;
  const texto = await esperarConteudo(
    async () => {
      chamadas += 1;
      return chamadas < 3 ? "" : PAINEL;
    },
    60,
    6000,
    60,
  );
  assert.equal(texto, PAINEL);
  assert.equal(chamadas, 3);

  // Nunca "inventa" conteúdo: sem texto nenhum, devolve o melhor que viu.
  let vazias = 0;
  const vazio = await esperarConteudo(
    async () => {
      vazias += 1;
      return "";
    },
    60,
    500,
    60,
  );
  assert.equal(vazio, "");
  assert.ok(vazias >= 2, "insistiu antes de desistir");
});

test("painel: resumo das tentativas mostra o método que leu", async () => {
  const r = await lerPainelAppa(
    opcoesBase({
      buscar: buscaFalsa({ "https://weather-appa.app.simport.com.br": { corpo: HTML_COM_JSON } }),
    }),
  );
  assert.match(resumoDasTentativas(r.tentativas), /API\/endpoint de dados/);
});
