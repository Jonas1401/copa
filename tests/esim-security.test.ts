import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

function arquivosRecursivos(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? arquivosRecursivos(path) : [path];
  });
}

test("todas as rotas de gestão eSIM exigem sessão administrativa", () => {
  const directory = "src/app/api/admin/esim";
  const routes = arquivosRecursivos(directory).filter((path) => path.endsWith("/route.ts"));
  assert.ok(routes.length > 0);
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /exigirAdmin\(\)/, `${relative(directory, route)} deve proteger cada operação`);
  }
});

test("fora do admin, somente os dois callbacks assinados possuem rota eSIM", () => {
  const directory = "src/app/api/esim";
  const routes = arquivosRecursivos(directory).filter((path) => path.endsWith("/route.ts"))
    .map((path) => relative(directory, path).replaceAll("\\", "/")).sort();
  assert.deepEqual(routes, ["payment-webhook/route.ts", "webhook/route.ts"]);
});
