import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

/**
 * RADAR DA PREVISÃO — o cartão de diagnóstico é EXCLUSIVO da área do
 * administrador (`/admin`).
 *
 * A tela pública **Tempo** (que o motorista abre) não mostra mais o cartão:
 * o monitoramento continua rodando no servidor e os avisos continuam chegando
 * no chat e por notificação, mas o diagnóstico (Composio, painel da APPA,
 * "Verificar agora") ficou só com quem administra.
 *
 * Este teste trava a regra: se alguém trouxer o cartão de volta para a tela do
 * motorista — ou tirá-lo do /admin — o teste falha.
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/radar-admin.test.ts
 */

test("o cartão do radar fica só na área do administrador", () => {
  const admin = ler("src/components/admin/AdminApp.tsx");
  assert.ok(
    admin.includes("@/components/admin/CartaoRadarPrevisaoAdmin"),
    "AdminApp não importa o cartão do radar",
  );
  assert.ok(
    admin.includes("<CartaoRadarPrevisaoAdmin"),
    "AdminApp não renderiza o cartão do radar no painel",
  );

  const tempo = ler("src/components/tempo/TempoApp.tsx");
  assert.ok(
    !/CartaoRadarPrevisao/.test(tempo),
    "a tela Tempo (motorista) ainda mostra o cartão do radar",
  );

  const pagina = ler("src/app/tempo/page.tsx");
  assert.ok(
    !/statusRadarClima|radar=/.test(pagina),
    "a página /tempo ainda lê a situação do radar no servidor",
  );

  assert.ok(
    !existsSync("src/components/tempo/CartaoRadarPrevisao.tsx"),
    "o componente antigo do radar (na pasta do Tempo) ainda existe",
  );
});

test("as rotas do radar exigem sessão de administrador", () => {
  const rota = ler("src/app/api/tempo/radar/route.ts");

  const inicioGet = rota.indexOf("export async function GET");
  const inicioPost = rota.indexOf("export async function POST");
  assert.ok(inicioGet >= 0 && inicioPost > inicioGet, "rota do radar mudou de formato");

  const get = rota.slice(inicioGet, inicioPost);
  assert.ok(get.includes("exigirAdmin"), "GET /api/tempo/radar sem exigirAdmin");

  const post = rota.slice(inicioPost);
  assert.ok(post.includes("exigirAdmin"), "POST /api/tempo/radar sem exigirAdmin");
});
