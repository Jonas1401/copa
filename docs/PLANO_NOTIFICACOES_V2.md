# Plano de Notificações v2 — Sem Excesso, Mas Eficaz (2026)

> **Objetivo**: cortar spam de clima e navios sem perder o aviso importante.

---

## Problema anterior

| Canal | Frequência antiga | Efeito |
|-------|-------------------|--------|
| **Boletim** | 4x/dia (00h, 06h, 12h, 18h) a cada 5h | Madrugada 00h acorda motorista dormindo; tarde 12h redundante |
| **Alerta tempo ruim** | repete a cada **3h** enquanto chuva/vento persiste | Até 8 notificações iguais por dia |
| **Radar** | releitura a cada **5 min**, intervalo **20 min**, **3/h** sem limite diário | Até **72 notificações/dia** em tempo instável; qualquer nuance (15% chuva, 10 km/h vento) virava aviso |
| **Navios fertilizantes** | intervalo **5 min**, até **3 avisos separados** por ciclo, sem filtro ETB | Navio com ETB daqui 2 semanas já avisava; 2 navios = 2 notificações seguidas; potencial 30+/dia |
| **Total potencial** | **~80-100 notificações/dia** se tempo instável + 2 navios | Usuário silencia tudo = perde aviso útil |

Motorista desativa notificações → perde "NA VEZ".

---

## Solução v2 — Plano anti-excesso

### 1) Tempo — 3 camadas com prioridade

```
ALERTA (grave)  >  RADAR (mudança relevante)  >  BOLETIM (resumo do dia)
     ↑                    ↑                           ↑
   só se chuva/    só se mudança GRANDE         só 2x/dia
   vento real      e com intervalo longo        em horários úteis
```

#### a) Boletim — 4x → **2x/dia**

- **Antes**: `00h madrugada · 06h manhã · 12h tarde · 18h noite` (4/dia, intervalo 5h)
- **Agora**: `06h manhã · 18h noite` (**2/dia**, intervalo **10h**)
- **Por quê**: 00h ninguém vê (motorista dorme), 12h é redundante se manhã já avisou e radar cobre mudança grave do meio-dia. 06h e 18h cobrem ida e volta do porto.
- **Antispam extra**: se o radar grave avisou nos últimos **90 min**, o boletim aguarda (evita dupla notificação).

> `src/lib/clima-boletim.ts`: `TURNOS` 4→2, `INTERVALO_MIN_MS` 5h→10h, `SILENCIO_POS_RADAR_MS` 90 min

#### b) Alerta de tempo ruim — 3h → **6h**

- **Antes**: lembrete a cada 3h (`LEMBRETE_MS = 3h`) enquanto `chuva`/`vento` persiste
- **Agora**: só posta quando **muda de nível** (`tempo-bom`→`chuva`). Se persistir, **1 lembrete após 6h** e depois silêncio até mudar.
- **Eficaz**: chuva forte já avisa na hora; repetir a cada 3h é spam. 6h dá tempo do motorista agir sem ser incomodado.
- **Máx** 2-3/dia por evento, não 8.

> `src/lib/clima-alerta.ts`: `LEMBRETE_MS` 3h→6h

#### c) Radar — 5 min/20 min/3h → **30 min/90 min/1h + 4/dia**

| Parâmetro | Antes | Agora (v2) | Efeito |
|-----------|-------|------------|--------|
| `CLIMA_MONITOR_MIN` (releitura) | 5 min | **30 min** | 6x menos leitura/rede |
| `CLIMA_MONITOR_PAINEL_MIN` | 5 min | **30 min** | idem painel |
| `CLIMA_MONITOR_SENSIBILIDADE` | `media` (20% chuva, 10 km/h) | **`baixa`** (30% chuva, 15 km/h, 8 nós) | só mudança grande vira aviso |
| `CLIMA_MONITOR_AVISO_MIN` (intervalo) | 20 min | **90 min** | 4,5x mais espaçado |
| `CLIMA_MONITOR_MAX_HORA` | 3 | **1** | máx 1/h |
| **Novo**: teto diário | — | **4/dia** | mesmo com tempestade oscilante, máx 4 |

- **Coalescência**: se boletim/alerta postou neste minuto (`registrarSomente`), radar apenas atualiza referência calado.
- **Silêncio pós-radar grave**: grava `clima_monitor_ultimo_aviso_ts`; boletim respeita 90 min.

> `src/lib/clima-monitor.ts`: `configRadar` padrões novos + `limiteDeAvisos` com teto 4/dia + timestamp grave

**Resultado tempo**:

| Cenário | Antes | Agora |
|---------|-------|-------|
| Dia de sol firme | 4 boletins + ~5 radares = 9 notificações | **2 boletins** = 2 |
| Dia com chuva forte persistente | 4 boletins + 8 alertas + 12 radares = 24 | **2 boletins + 1 alerta + 1 lembrete (6h) + 1-2 radares graves = 4-5** |
| Instabilidade rápida (frente fria) | até 3/h = 72/dia | **máx 1/h + 4/dia = 4/dia** |

Sem spam, mas chuva forte **sempre** avisa (grave = `requireInteraction`, fica na tela até tocar).

---

### 2) Navios — agrupado e filtrado

| Parâmetro | Antes | Agora (v2) | Justificativa |
|-----------|-------|------------|---------------|
| `INTERVALO_MS` | 5 min | **60 min** | Navio não muda de berço a cada 5 min; APPA atualiza de 30-60 min |
| `MAX_POR_CICLO` | 3 separados | **2 agrupados em 1 mensagem** | Se 2 navios surgem juntos, 1 resumo em vez de 2 notificações |
| Filtro ETB | nenhum (qualquer berço definido) | **ETB nas próximas 72h** (passado sempre passa, futuro >72h filtrado) | Evita avisar navio com ETB daqui 2 semanas sem relevância imediata |
| `MAX_POR_DIA` | — | **6/dia** | Mesmo com safra intensa, máx 6 |

**Agrupamento inteligente**:

- 1 navio novo → mensagem individual (como antes, ex.: `🚢 Berço definido! O LEO. K está programado para atracar em Paranaguá, berço 211...`)
- 2+ navios novos no mesmo ciclo → **1 mensagem resumo** (`🚢 2 navios de fertilizantes: LEO. K programado berço 211 com MAP (70.000 t) (ETB 02/10 08:00); ZY IDOL atracou...`) → 1 notificação, não 2.

> `src/lib/navios-aviso.ts`: `etbDentroJanela` + agrupamento `escreverResumoNavios` + teto diário

**Resultado navios**:

| Cenário | Antes | Agora |
|---------|-------|-------|
| 1 navio programado (ETB amanhã) | 1 aviso imediato | **1 aviso imediato** (igual) |
| 1 navio ETB daqui 10 dias | 1 aviso (spam distante) | **filtrado, sem aviso** |
| 3 navios surgem juntos | 3 notificações seguidas | **1 notificação resumo** |
| Semana com 10 navios | até 30 notificações | **máx 6/dia, 1/h** |

Eficaz: motorista sabe que tem serviço, sem ser acordado por navio que só atraca semana que vem.

---

### 3) Regras globais anti-spam mantidas

- **Deduplicação**: `clima_mudancas.assinatura` única por bloco de 3h + `naviosAvisos.chave` única (`P:programação:berço`, `M:...`, `A:...`)
- **Primeira leitura**: só registra, não avisa coisa antiga (evita spam ao ligar servidor)
- **Silenciados**: `chat_silenciados` continua respeitado (quem silenciou chat não recebe clima/navio, mas ainda recebe `NA VEZ`/`SAIU`)
- **RequireInteraction**: só para grave (chuva forte, rajada ≥40 km/h, tempestade, boletim.APPA tempo ruim, manobra confirmada) → notificação fica na tela até tocar
- **Cache**: radar `suave` usa cache 10 min (`VIDA_CACHE`) quando chamado por `tickRadar` (app aberto) → custo 1 comparação de horário na maioria das vezes

---

## Configuração (variáveis de ambiente)

Todas opcionais, padrões já são v2:

```env
CLIMA_MONITOR_ATIVO=1          # 0 desliga radar
CLIMA_MONITOR_MIN=30           # releitura WRF/estação (min) — antes 5
CLIMA_MONITOR_PAINEL_MIN=30    # releitura painel APPA (min) — antes 5
CLIMA_MONITOR_SENSIBILIDADE=baixa  # baixa|media|alta — antes media
CLIMA_MONITOR_AVISO_MIN=90     # intervalo mínimo entre avisos (min) — antes 20
CLIMA_MONITOR_MAX_HORA=1       # teto por hora — antes 3 (+ 4/dia automático)
# Boletim: 2/dia (06h,18h) 10h intervalo — codificado em src/lib/clima-boletim.ts
# Navios: 60 min intervalo, ETB 72h, 6/dia — codificado em src/lib/navios-aviso.ts
```

Para voltar ao comportamento antigo (não recomendado), basta sobrescrever na Vercel.

---

## Como testar

```bash
# Puros (sem banco)
./node_modules/.bin/tsx --test tests/clima-monitor.test.ts tests/clima-boletim.test.ts tests/navios.test.ts

# Com banco local fila_push_test_* (cron → chat → Push)
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_demo \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_demo \
./node_modules/.bin/tsx --test tests/clima-boletim.test.ts tests/navios-aviso.test.ts tests/clima-monitor.test.ts
```

Build: `npm run typecheck && npm run build`

---

## Resumo executivo (para o motorista)

- **Tempo**: você recebe **no máximo 4-5 avisos por dia** em vez de 20+. Manhã (06h) e noite (18h) sempre têm boletim; se o tempo virar (chuva forte, vendaval, frente fria), o radar te avisa em até 90 min, mas não fica repetindo a mesma coisa.
- **Navios**: só avisa navio de **fertilizante** com berço definido e que chega em **até 3 dias**. Se 2 navios aparecem juntos, vem **1 mensagem só**. No máximo 6 por dia.
- **Eficaz**: aviso grave (chuva ≥5 mm, rajada ≥40 km/h, tempestade) fica na tela até você tocar, mesmo com app fechado. O resto vem silencioso mas visível.
- **Sem excesso**: sem madrugada 00h, sem repetir chuva a cada 3h, sem 3 avisos por hora do radar, sem navio distante.

---

*Implementado em: `src/lib/clima-boletim.ts`, `src/lib/clima-alerta.ts`, `src/lib/clima-monitor.ts`, `src/lib/navios-aviso.ts`, `.env.example`*
