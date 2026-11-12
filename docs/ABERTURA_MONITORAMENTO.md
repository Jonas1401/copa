# Verificação imediata dos links na abertura do CopaLinks

Regra do proprietário: **ao abrir o CopaLinks (ou iniciar uma sessão nova), todos
os link de monitoramento ativos são verificados na hora**. Nada espera o
intervalo periódico, o temporizador ou uma atualização manual da tela. Depois
da primeira consulta, cada monitoramento continua no intervalo que já estava
configurado.

## Como funciona

```text
app abre
  └─ GET /api/estado?abertura=1            (uma vez por abertura)
       ├─ começa já, em paralelo com a resposta
       ├─ registro de links (src/lib/monitor-links.ts)
       │    ├─ consulta HTTP de cada link ATIVO (GET + Range: bytes=0-0, 4 s)
       │    ├─ nova tentativa automática (2 por link)
       │    └─ grava horário + resultado de cada link
       └─ leitores existentes, com `forcar`
            ├─ Status do Portal do Motorista   (monitorarStatusEmSegundoPlano)
            ├─ aba “Fila” do portal            (atualizarFilaEntreCiclos)
            └─ navios (2 fontes)               (verificarNaviosFertilizantes)
```

Depois dessa rodada, **nada muda**: o cron de 1 minuto, a releitura da fila a
cada 20 s com o app aberto, o Status de 10 em 10 minutos por motorista e o
monitor de navios de 5 em 5 minutos continuam exatamente como estavam.

## Quais links são monitorados

| id | Link | Leitor | Ativo quando |
| --- | --- | --- | --- |
| `intranet-geral` | quadro geral da intranet | app | `PORTAL_FONTE`/`FONTE_FILA` = `quadro` |
| `intranet-A/B/M` | quadro de cada livro | app | `FONTE_FILA` = `quadro` |
| `portal-status` | Portal do Motorista (Status) | portal | `PORTAL_FONTE` = `portal` (padrão) |
| `portal-fila` | Portal · aba Fila | portal | `FONTE_FILA` = `portal` (padrão) |
| `navios-atracados` | berth-bloom-buddy | navios | sempre |
| `navios-manobras` | berth-bloom-tracker | navios | sempre |

Os endereços vêm das **mesmas** fontes que os leitores usam (`linksDoSite()`,
`urlPortal()`, `POLITICA_AUTOMACAO`). Nenhum link original foi alterado e
nenhum intervalo foi redefinido: `monitor-links.ts` só **lê** os intervalos já
configurados (`INTERVALO_VARREDURA`, `intervaloStatusMs()`, `intervaloDaFilaMs()`,
`intervaloNaviosMs()`).

## Garantias

- **Sem consulta duplicada**: uma consulta por link de cada vez e uma rodada por
  janela de 10 s. Duas telas abertas juntas (ou o app voltando do segundo plano
  em seguida) reaproveitam a rodada em curso.
- **Sem sobreposição**: a segunda chamada de `verificarTodos()` recebe a
  promessa da rodada que já está rodando — não abre outra.
- **Falha isolada**: cada link tem o seu resultado. Um fora do ar não cancela os
  outros (`Promise.allSettled`), não muda o estado deles e não marca o
  monitoramento inteiro como offline.
- **Reconexão**: o link que falhou é tentado de novo na rodada seguinte (a
  próxima abertura do app, a volta para a tela ou o ciclo normal do leitor) e
  volta a “no ar” com o horário da resposta boa (`ultimaConsultaOkEm`).
- **Registro**: `ultimaConsultaEm`, `httpStatus`, `latenciaMs`, `erro`,
  `tentativas` e `ultimaConsultaOkEm` por link. O retrato também é gravado em
  `configuracao` (`monitor_links_v1`, no máximo a cada 30 s) e devolvido pela
  rota em `linksMonitorados` — **diagnóstico**: a tela e o layout não mudam.

## Regras preservadas de propósito

- O **freio de login** do portal continua valendo dentro da leitura forçada: a
  abertura não faz login fora da hora de nenhum motorista.
- A **reserva no banco** dos leitores (fila/Status) continua sendo quem impede
  duas instâncias de abrirem o portal juntas. `forcar` pula só as esperas
  locais (4 s entre conferências e a folga do intervalo).
- A sessão da conta que lê a fila entre ciclos continua tendo de servir; nada
  de login novo por causa da abertura.
- Links, intervalos, regras de monitoramento, notificações, banco, layout e
  demais funcionalidades não foram alterados.

## Como conferir em produção

1. Abra o app e, em seguida, chame `GET /api/estado?abertura=1` (ou
   `GET /api/estado`): o campo `linksMonitorados` traz o horário e o resultado
   de cada link.
2. No banco, `select * from configuracao where chave = 'monitor_links_v1'` mostra
   o último retrato gravado.
3. Nos logs do servidor, uma falha de rede aparece como
   `HTTP 500`/`ECONNRESET` no link específico, sem parar os outros.

## Arquivos

- `src/lib/monitor-links.ts` (novo): registro e verificação dos links.
- `src/app/api/estado/route.ts`: `?abertura=1`, `acordarMonitoramentos()` e o
  campo `linksMonitorados`.
- `src/components/MonitorApp.tsx`: envia `abertura=1` uma vez por abertura (e ao
  voltar para a tela, no máximo uma vez por minuto) e usa a resposta.
- `src/lib/portal-monitor.ts`: `forcar` em `atualizarFilaEntreCiclos` e
  `monitorarStatusEmSegundoPlano`.
- `src/lib/navios-monitor.ts`: `intervaloNaviosMs` exportado (mesmo valor).
- `tests/monitor-links.test.ts`: 6 testes (abertura imediata, isolamento,
  retentativa, sem duplicidade, sem sobreposição, ligação rota↔app).
