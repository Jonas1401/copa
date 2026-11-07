# Espelho do COPALINKS — Navios de Fertilizantes

Cópia do painel `https://berth-buddy-bot.lovable.app/` **dentro** do CopaLinks,
acessível de duas formas pelo ícone **Sobre**: o pequeno selo de navio no próprio
ícone abre `/navios` direto, e a aba Sobre traz o cartão
"Navios · cópia do COPALINKS" com os dois atalhos.

## Telas

| Rota | Equivale a | Conteúdo |
|---|---|---|
| `/navios` | `/` da referência | Logo COPALINKS, botões **Manobras Previstas** e **Abrir site oficial da APPA**, "Atualizado HH:MM:SS", grupo por porto (PARANAGUÁ/ANTONINA) e cartões por berço: navio, N operadoras, operadora + mercadoria + saldo, barra "Descarga N% descarregado", "Saldo Total do Navio". |
| `/navios/sinprapar` | `/sinprapar` da referência | Cabeçalho SINPRAPAR, botões **Navios Atracados** e **Abrir site oficial do SINPRAPAR**, filtros **Em manobra / Aguardando manobra / Atracado**, cartões com navio, mercadoria, Atracar/Desatracar, `dd/mm hh:mm·XX— Título: berço`, explicação da manobra e situação (EM ANDAMENTO / A CONFIRMAR / PREVISTA…). |
| `/sinprapar` | — | Redireciona para `/navios/sinprapar`. |
| `/api/navios/espelho` | — | JSON com `modo`, `fontes`, `atracados`, `manobras` e `aviso`. |

## As duas fontes

1. **APPA — Line-up Retroativo** (`URL_LINEUP` em `src/lib/navios.ts`): tabelas
   por seção (ATRACADOS, PROGRAMADOS, AO LARGO, ESPERADOS, DESPACHADOS…).
   `linhasAppa()` alinha as linhas com `rowspan` pelo cabeçalho para juntar as
   várias operadoras de um mesmo navio sem trocar operador por mercadoria.
2. **SINPRAPAR — Manobras Previstas** (`URL_MANOBRAS`): `parseManobrasSinprapar()`
   lê data, hora, navio, `XX: berço`, IMO e situação.

As leituras são cruzadas por `nome`/`IMO`: a APPA dá a mercadoria, o SINPRAPAR
dá a manobra. `mapaDeCargas()` guarda apenas mercadorias que passam em
`ehFertilizante()` — ureia, cloretos de potássio, sulfato de amônio, MAP/DAP/NPK,
adubos e fertilizantes nitrogenados, fosfatos etc. Navios de soja, açúcar,
contêineres, milho e derivados de petróleo ficam de fora das duas telas.

### Cálculos literais

- **Saldo da Operadora** e **Saldo Total do Navio** são reproduzidos como a APPA
  escreve (`18.803,660 Tons.`), sem arredondar.
- **Descarga** = `round((1 − saldo total / soma dos previstos) × 100)`, limitado a
  0–100. Exemplo real: GULLWING `19.800` previstos / `18.803,660` de saldo → **5%**;
  KOSMAN `51.588` / `12.960,920` → **75%**; LEO. K `71.400` / `1.915,870` → **97%**.
- Data, hora, código, berço e situação das manobras são os literais da fonte.
  `EF` (entrada e fundeio) não é anunciado como atracação realizada.

## Atualização e contingência

- `GET /api/navios/espelho` baixa as duas páginas com `no-store`, timeout de 9 s
  e decodificação ISO-8859-1 quando necessário; cache de 30 s no servidor.
- O cliente abre com a última leitura gravada (`painelReferencia()`), busca a API
  imediatamente e repete a cada **30 s**; há botão manual de atualizar e LED de
  estado (AO VIVO / PARCIAL / REFERÊNCIA).
- `src/lib/espelho-navios-referencia.json` contém uma leitura pública das duas
  fontes (APPA 07/11/2026 14:16 e SINPRAPAR 07/11/2026 14:10). É usada **só**
  quando a fonte correspondente falha, e a tela identifica isso no selo, no
  aviso e no rodapé "Fontes monitoradas". Ambientes sem saída para a internet
  (prévia local) mostram esse estado; em produção as duas leituras são ao vivo.
- Falha de uma fonte não derruba a outra: `modo: "parcial"` preserva a leitura
  ao vivo de quem respondeu e a última leitura gravada de quem falhou.

## Tema

Todos os componentes usam os tokens de `src/app/globals.css` (Dark Navy):
`#000D16` no fundo, `#071A28` nos cartões, `#002F3B` nos painéis, ciano nos
filtros ativos e links, verde no progresso de descarga, amarelo para
"A CONFIRMAR" e azul para "PREVISTA". `tests/tema-dark-navy.test.ts` varre as
telas e garante que nenhuma cor fora da paleta entre na interface.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/espelho-navios.ts` | Parsers, cruzamento, filtro de fertilizantes, leitura HTTP e cache |
| `src/lib/espelho-navios-referencia.json` | Última leitura pública para contingência |
| `src/app/api/navios/espelho/route.ts` | API de atualização |
| `src/components/espelho/EspelhoNaviosApp.tsx` | As duas telas da cópia |
| `src/app/navios/page.tsx`, `src/app/navios/sinprapar/page.tsx`, `src/app/sinprapar/page.tsx` | Rotas |
| `src/components/MonitorApp.tsx` | Cartão de acesso na aba **Sobre** |
| `src/components/inicio/NavInferior.tsx` | Selo de navio no próprio ícone **Sobre** (atalho direto para `/navios`) |
| `tests/espelho-navios.test.ts` | Regressão de parsers, filtros, saldos, modos e links |

O monitor automático do chat (`src/lib/navios-monitor.ts`, `/api/cron`) continua
independente: esta cópia é uma tela de consulta, não um novo publicador de
avisos.
