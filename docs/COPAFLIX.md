# COPAFLIX — entretenimento dentro do CopaLinks

O **CopaFlix** é uma seção nova do CopaLinks: filmes, séries, novelas e TV ao vivo
com a mesma identidade visual do aplicativo (fundo azul-marinho quase preto,
detalhes em ciano e botões dourados). Ele **não reconstrói o app**: login,
cadastro, fila de ponto, chat, notificações, painel administrativo, banco de
dados e PWA continuam iguais. A única mudança visível fora do módulo é a seção
**Entretenimento** no menu ⋮ do canto superior esquerdo.

```
menu ⋮  →  Entretenimento  →  /copaflix
                              ├── Início        (roda 3D + destaques + fileiras)
                              ├── Filmes
                              ├── Séries
                              ├── Novelas
                              ├── TV ao vivo
                              ├── Favoritos
                              └── Continuar assistindo (+ histórico)
```

---

## 1. Como a integração foi feita

| Decisão | Por quê |
| --- | --- |
| Rota isolada `/copaflix` (App Router) | O módulo tem layout, CSS e metadados próprios. Nenhuma folha de estilo nova é carregada nas outras telas. |
| Um único ponto de entrada no CopaLinks (`MenuConta.tsx`) | Só a seção "Entretenimento" e seus seis atalhos foram acrescentados ao menu existente. O restante do menu (nome, notificações, portal, admin) não mudou. |
| Nenhuma alteração em banco, login, sessões, push ou PWA | Favoritos/progresso/histórico ficam no `localStorage` do aparelho, como o resto das preferências locais do app. Não há tabela nova e não há migração. |
| Fontes autorizadas configuradas por variável de ambiente | Trocar/adicionar fonte não exige mexer no código nem publicar outra versão do app. Credenciais ficam só no servidor. |
| Catálogo de demonstração ligado por padrão | Sem configurar nada, a tela já mostra conteúdo **legal** (domínio público e Creative Commons) para validar a interface e o player. `COPAFLIX_DEMO=0` desliga. |
| Categorias sem fonte aparecem vazias, com explicação | Nunca preencher com link pirata ou conteúdo inventado. |

### O que foi comparado dos projetos indicados

| Projeto | Licença | O que foi aproveitado |
| --- | --- | --- |
| [IPTVnator](https://github.com/4gray/iptvnator) | MIT | **Referência de arquitetura e de experiência**, não código: leitura de listas M3U, agrupamento por `group-title`, busca de canais, favoritos locais e EPG. Nenhum arquivo do projeto foi copiado. |
| [Jellyfin Web](https://github.com/jellyfin/jellyfin-web) | GPL-2.0 | **Referência de catálogo** (filmes/séries, temporadas e episódios, "continuar assistindo"). Não houve cópia de código — GPL-2.0 não é compatível com incorporar arquivos aqui. |
| [Jellyfin Server](https://github.com/jellyfin/jellyfin) | GPL-2.0 | Só a **API HTTP pública** (`/Items`, `/Shows/{id}/Episodes`, `/Items/{id}/Images`, `/Videos/{id}/stream`) é consumida via `fetch`, o que independe de licença do cliente. |
| [iptv-org/iptv](https://github.com/iptv-org/iptv) | Unlicense (domínio público) | Nada foi copiado. O preset opcional `br-publicos` apenas aponta para a playlist publicada pelo projeto e filtra pelas emissoras públicas brasileiras (ver 3.2). A licença cobre a compilação, **não** os fluxos de terceiros. |

> O CopaFlix foi escrito do zero. Os dois projetos acima serviram para decidir
> o formato dos dados (M3U + XMLTV + Jellyfin) e o comportamento da interface.

### Dependência nova

| Pacote | Versão | Licença | Motivo |
| --- | --- | --- | --- |
| `hls.js` | 1.7.x | Apache-2.0 | Reproduzir HLS (`.m3u8`) no Chrome/Android/Firefox. É JavaScript puro: **não** altera build, permissões, PWA nem APK. Safari/iOS usam o HLS nativo. |

---

## 2. Arquivos

### Novos — módulo CopaFlix

```
src/app/copaflix/layout.tsx                 layout + metadados do módulo
src/app/copaflix/page.tsx                   abertura (fontes com prazo de 4 s)
src/app/copaflix/loading.tsx                esqueleto enquanto as fontes respondem
src/app/copaflix/error.tsx                  falha inesperada sem quebrar o app
src/app/copaflix/not-found.tsx              título fora do acervo
src/app/copaflix/titulo/[id]/page.tsx       ficha do título (link direto)
src/app/copaflix/copaflix.css               tema do módulo (paleta do app)

src/app/api/copaflix/canais/route.ts        canais + situação das fontes
src/app/api/copaflix/epg/route.ts           programa que está no ar (XMLTV)
src/app/api/copaflix/jellyfin/imagem/[id]/route.ts    cartaz via proxy
src/app/api/copaflix/jellyfin/stream/[id]/route.ts    vídeo via proxy (Range)
src/app/api/copaflix/jellyfin/serie/[id]/route.ts     episódios sob demanda
src/app/api/copaflix/fontes/route.ts                  testa as fontes de um título (HEAD)

src/components/copaflix/CopaFlixApp.tsx     tela principal (abas, busca, fileiras)
src/components/copaflix/CabecalhoCopaFlix.tsx  topo (logo, busca, minha lista)
src/components/copaflix/abas.ts             abas do módulo e do rodapé
src/components/copaflix/Carrossel3D.tsx     roda 3D arrastável
src/components/copaflix/Cartaz.tsx          capa (cartaz autorizado ou arte do app)
src/components/copaflix/Fileira.tsx         faixa horizontal de capas
src/components/copaflix/Player.tsx          player (HLS/MP4, retomada, qualidade)
src/components/copaflix/TituloDetalhe.tsx   ficha + episódios + player
src/components/copaflix/TvAoVivo.tsx        TV ao vivo (categorias, busca, EPG)
src/components/copaflix/useCopaFlixLocal.ts favoritos/progresso/histórico na tela

src/lib/copaflix/tipos.ts                   tipos do acervo
src/lib/copaflix/catalogo.ts                catálogo de demonstração + consultas
src/lib/copaflix/fontes.ts                  leitura das fontes no servidor
src/lib/copaflix/m3u.ts                     leitor de listas M3U/M3U8
src/lib/copaflix/epg.ts                     leitor de guia XMLTV
src/lib/copaflix/jellyfin.ts                cliente da API do Jellyfin
src/lib/copaflix/tmdb.ts                    cartazes do TMDB (opcional)
src/lib/copaflix/url-segura.ts              validação de URL (anti-SSRF)
src/lib/copaflix/armazenamento.ts           favoritos/progresso/histórico locais
src/lib/copaflix/retomada.ts                regra de "continuar de onde parou"
src/lib/copaflix/fontes-midia.ts            lista de fontes + troca para o espelho

public/images/copaflix/arte-0..5.webp        arte cinematográfica do app
tests/copaflix.test.ts                      37 testes do módulo
docs/COPAFLIX.md                            este guia
```

### Alterados (mudanças mínimas)

| Arquivo | Alteração | Por quê |
| --- | --- | --- |
| `src/components/inicio/MenuConta.tsx` | acrescentada a seção **Entretenimento** com 6 atalhos | único ponto de entrada pedido; o resto do menu ficou intacto |
| `.env.example` | bloco `COPAFLIX_*` no fim | documentar as fontes sem segredo |
| `package.json` / `package-lock.json` | dependência `hls.js` | reprodução de HLS |
| `README.md` | não alterado | o guia do módulo está neste arquivo |

**Não foram tocados:** login/cadastro, `/admin`, `/api/estado`, chat, push,
service worker, `manifest.webmanifest`, `next.config.ts`, Dockerfile, Android,
esquema do banco e as demais telas.

---

## 3. Configurar as fontes legais

Todas são **opcionais** e lidas só no servidor (`src/lib/copaflix/fontes.ts`).
Depois de alterar, publique de novo (Vercel → Redeploy).

### 3.1 Listas M3U/M3U8 autorizadas

```env
# uma ou várias listas, separadas por vírgula
COPAFLIX_M3U_URLS=https://exemplo.com/lista-autorizada.m3u
# guia de programação (opcional, XMLTV)
COPAFLIX_EPG_URL=https://exemplo.com/guia.xml
```

- Use somente listas que a operação **tem direito de distribuir** (serviço
  contratado, canais públicos oficiais, lista própria).
- Canais são agrupados pela `group-title`; o `tvg-id` casa com o EPG.
- A lista é lida pelo servidor (o navegador nunca busca a lista), com limite de
  4 MB, 7 s de prazo e cache de 5 min.
- Ao configurar uma lista, os canais de exemplo saem de cena automaticamente.

### 3.2 Lista pública do iptv-org, com curadoria

O repositório [iptv-org/iptv](https://github.com/iptv-org/iptv) reúne links de
milhares de canais públicos do mundo todo. **Não copiamos a lista para dentro
do app** — e não recomendamos copiar: a compilação está em domínio público
(Unlicense, o `LICENSE` do repositório), mas os *fluxos* são de terceiros, o
próprio projeto avisa que não tem controle sobre o destino dos links e a maior
parte não tem autorização verificada. Colar a lista inteira quebraria a regra
de "só fonte autorizada" e traria canais instáveis, geo-bloqueados e sem
licença.

O caminho seguro é apontar para a publicação oficial do iptv-org com curadoria:

```env
# preset pronto: lista do iptv-org + apenas emissoras públicas brasileiras
COPAFLIX_M3U_PRESET=br-publicos
```

O preset faz duas coisas: usa
`https://iptv-org.github.io/iptv/countries/br.m3u` (buscada pelo servidor a
cada 5 min, nunca pelo navegador) e mantém somente **TV Brasil, TV Câmara (e
TV Câmara 2/Salvador), TV Senado, TV Justiça, Canal Gov, Canal Educação, Canal
Saúde, Canal Futura e Cultura Pará** — emissoras cuja transmissão pública é
autorizada pelos próprios radiodifusores. Na lista de 12/11/2026 isso
corresponde a ~10 dos 393 canais do arquivo do Brasil.

Curadoria própria (qualquer lista, com ou sem `tvg-id`):

```env
COPAFLIX_M3U_URLS=https://iptv-org.github.io/iptv/countries/br.m3u
COPAFLIX_M3U_INCLUIR="TVBrasil|TVCamara|CanalGov|CanalEducacao"
COPAFLIX_M3U_EXCLUIR="\[Not 24/7\]"
```

- A regra é uma expressão regular, sem diferenciar maiúsculas, testada contra
  `tvg-id + nome + grupo` e contra variantes sem espaço/acento (`TV Senado` casa
  com `TVSenado`). `COPAFLIX_M3U_INCLUIR` do operador **sobrepõe** a do preset.
- Expressão inválida é ignorada (com aviso no log) em vez de derrubar a página.
- **Índice completo recusado:** `https://iptv-org.github.io/iptv/index.m3u` (ou
  `all.m3u`) sem `COPAFLIX_M3U_INCLUIR` **não é carregado**. Nada de 5.000 canais
  de terceiros sem autorização: a fonte aparece no painel como "recusada sem
  curadoria". Listas por país/categoria continuam aceitas; com o filtro, o
  índice completo também.
- O painel "Fontes e licenças" mostra a lista, o preset e se há curadoria
  ativa em cada carregamento.
- Continua valendo a regra: **você responde** pelo que a sua operação exibe.
  O preset só inclui emissoras públicas; qualquer outra coisa exige autorização.

### 3.3 Jellyfin (biblioteca própria)

```env
COPAFLIX_JELLYFIN_URL=https://jellyfin.seu-dominio.com
COPAFLIX_JELLYFIN_API_KEY=chave-de-api-do-jellyfin
COPAFLIX_JELLYFIN_USER_ID=opcional
```

- A chave **nunca** vai para o navegador: cartazes e vídeo passam por
  `/api/copaflix/jellyfin/...` no servidor do CopaLinks.
- A reprodução usa `static=true` (sem transcodificação). Arquivos com codec
  incompatível ou legenda embutida podem ser recusados pelo servidor — a tela
  avisa com clareza.
- Jellyfin em rede local (ex.: `192.168.x.x`): por padrão o app **bloqueia** IP
  privado (proteção contra SSRF). Se o CopaLinks roda dentro da mesma rede,
  defina `COPAFLIX_PERMITIR_REDE_INTERNA=1` conscientemente.

### 3.4 TMDB (cartazes e fundos — opcional)

```env
COPAFLIX_TMDB_KEY=sua-chave-da-api-do-tmdb
```

- Usada apenas para buscar cartaz/fundo dos títulos que não têm imagem, no
  servidor, com prazo de 3,5 s.
- A atribuição exigida aparece no rodapé e na ficha:
  _"Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB."_
- Sem a chave, o app usa a arte própria (nada é enviado ao TMDB).

### 3.5 Catálogo de demonstração

```env
COPAFLIX_DEMO=0   # desliga domínio público/Creative Commons
```

Padrão: ligado. Ele contém:

- **Domínio público** (Internet Archive): *Nosferatu* (1922), *A Noite dos
  Mortos-Vivos* (1968), *Plano 9 do Espaço Sideral* (1959).
- **Creative Commons** (Blender Foundation, CC BY 3.0): *Big Buck Bunny*,
  *Elephants Dream*, *Sintel*, *Tears of Steel* — e a coleção "Blender Open
  Movies" (1 temporada, 4 episódios).
- **Canais oficiais com transmissão pública**: NASA TV, DW English, Al Jazeera
  English, France 24 English. Podem ter bloqueio por país ou sair do ar.

#### Fontes de vídeo (verificadas) e espelhos

O balde de amostras do Google (`commondatastorage.googleapis.com/gtv-videos-bucket`)
usado no começo **passou a responder HTTP 403 para todos os arquivos** e foi
abandonado. As fontes atuais são:

| Título | Fonte principal | Espelho |
| --- | --- | --- |
| Nosferatu, A Noite dos Mortos-Vivos, Plano 9 | Internet Archive (MP4) | — |
| Big Buck Bunny | `archive.org/download/BigBuckBunny_124` (H.264 720p) | HLS do Mux (`x36xhzz.m3u8`) |
| Sintel | `archive.org/download/Sintel/sintel-2048-surround.mp4` | — |
| Elephants Dream | `archive.org/download/ElephantsDream/ed_hd.mp4` | — |
| Tears of Steel | `download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov` | mesmo filme em WebM |

- Se a primeira fonte falhar (fora do ar, CORS, bloqueio regional), o player
  **troca sozinho** para o espelho e avisa em uma faixa discreta
  ("A fonte Internet Archive não respondeu — tentando Mux (HLS)…").
- Só quando todas falham aparece o erro, com a lista das fontes testadas.
- **Capas reais**: os títulos de demonstração usam a capa do próprio item do
  Internet Archive (`archive.org/services/img/<id>`), com queda automática para
  a arte do app se a imagem não existir. Os créditos/licenças seguem na ficha.
- **Teste de disponibilidade**: na ficha, o botão “Testar as fontes agora” usa
  `/api/copaflix/fontes?id=…` — o **servidor** faz um `HEAD` em cada fonte
  (5 s de prazo, cache de 5 min) e devolve “no ar / fora do ar”. A rota só
  aceita ids do próprio catálogo (nunca uma URL vinda da tela), então não serve
  para sondar rede interna.

---

## 4. O que a interface entrega

- **Roda 3D de capas** de verdade: arraste com dedo/mouse/caneta, roda em
  perspectiva, capa central em evidência, inércia curta, encaixe na capa mais
  próxima, teclado (← → Home End Enter), clique na capa lateral para trazê-la
  ao centro e clique na central para abrir. Respeita "reduzir movimento".
- **Destaque grande** com título, ano, duração, classificação, gêneros, sinopse,
  botão Assistir, Detalhes e Minha lista.
- **Fileiras por categoria** (Em destaque, Mais populares, gêneros) com rolagem
  por toque e setas no desktop.
- **Busca geral** instantânea por título, sinopse, gênero, ano e canal.
- **Ficha do título** com fonte, crédito/licença, favoritos, progresso e
  temporadas/episódios (quando houver).
- **Player** com play/pause, barra de progresso, volume, tela cheia, qualidade
  (quando o HLS oferece), retomada, próximo episódio e mensagens de erro. A
  retomada funciona também em vídeos curtos: recomeça do zero só quando falta
  menos que 10 s **ou** menos que 10% do vídeo — um curta de 20 s continua de
  onde parou em vez de apagar o progresso.
- **TV ao vivo** por categoria, busca, atualização da lista, EPG ("agora") e
  player embutido.
- **Favoritos**, **Continuar assistindo** e **Histórico** no aparelho, com
  opção de apagar.
- **Painel de fontes e licenças** (ícone de escudo) mostrando o que está
  configurado, sem nunca exibir chaves.

---

## 5. Como testar

### No computador

```bash
npm install
npm run dev          # http://localhost:3000/copaflix
```

1. Abra `/` e clique no **⋮** no canto superior esquerdo → **Entretenimento**.
2. Confira os seis atalhos (Filmes, Séries, Novelas, TV ao vivo, Favoritos,
   Continuar assistindo).
3. Arraste a roda 3D para os dois lados; use ← → com a roda focada; clique na
   capa central para abrir a ficha.
4. Em **TV ao vivo**, escolha um canal: se a emissora bloquear o sandbox/rede,
   o player mostra o motivo e mantém a lista funcionando.
5. Abra uma ficha, toque em **Assistir**, aguarde alguns segundos e verifique
   play/pause, volume, barra, tela cheia e qualidade.
6. Volte para o Início: o título deve aparecer em **Continuar assistindo**.
7. Recarregue a página: favoritos e progresso continuam (mesmo aparelho).

### No navegador Android

1. Abra o endereço publicado no Chrome do aparelho.
2. Repita o roteiro acima; teste o arrasto com o dedo (a página continua
   rolando na vertical).
3. A barra de navegação inferior do CopaFlix aparece em telas pequenas.

### No PWA instalado

1. Instale o CopaLinks normalmente (menu do Chrome → Instalar aplicativo).
2. Abra pelo ícone, entre em ⋮ → Entretenimento.
3. Instalação, abertura offline do restante do app e notificações continuam
   iguais: o módulo não mexeu no service worker nem no manifest.

### APK Android

Nada muda. O `android/MonitorApp` é o app **companion** do monitor de
WhatsApp/Firebase e não embute a interface web; o CopaFlix é acessado pelo
navegador/PWA. Nenhuma permissão nova, nenhum Gradle alterado.

### Verificações automáticas

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # node:test (inclui tests/copaflix.test.ts)
npm run build       # next build
```

---

## 6. Segurança e privacidade

- **Chaves só no servidor.** Nenhum componente cliente lê variáveis de
  Jellyfin/TMDB. O teste `tests/copaflix.test.ts` falha se alguém tentar.
- **Anti-SSRF.** `url-segura.ts` só aceita `http/https` público, sem
  credenciais embutidas, bloqueando `localhost`, IPs privados/reservados,
  IPv6 local e sufixos internos. Redirecionamentos são revalidados. A exceção
  para rede interna é explícita (`COPAFLIX_PERMITIR_REDE_INTERNA=1`).
- **Sem execução de código de terceiros.** M3U e XMLTV são apenas texto
  interpretado com limites de tamanho; nada é avaliado como script.
- **Sem contorno de proteção.** Não há DRM, torrent, embed de site protegido
  nem proxy aberto de URLs arbitrárias. Só os domínios configurados são lidos.
- **Privacidade.** Favoritos (`copaflix:favoritos:v1`), progresso
  (`copaflix:progresso:v1`) e histórico (`copaflix:historico:v1`) ficam no
  `localStorage` do aparelho. Não entram no banco, no push nem em relatórios.
- **Sanitização de imagem.** O proxy do Jellyfin aceita só `image/jpeg|png|webp|avif`
  e ids `[A-Za-z0-9_-]{1,64}`.

---

## 7. Limitações conhecidas (honestas)

1. **CORS / bloqueio geográfico.** Muitos canais oficiais só abrem no país de
   origem ou exigem cabeçalhos que um site não pode enviar. O player explica o
   caso e não tenta contornar nada.
2. **DRM.** Conteúdo protegido por Widevine/PlayReady não abre no navegador
   fora dos apps oficiais. O CopaFlix não faz engenharia reversa de chaves.
3. **Jellyfin.** Reprodução direta (`static=true`) não transcodifica; arquivos
   MKV/legendas embutidas podem falhar.
4. **EPG.** Depende de um guia XMLTV público e do `tvg-id` bater com o canal.
5. **Fontes do catálogo de demonstração** podem sair do ar (Internet Archive,
   espelho de testes do Blender e emissoras). As URLs ficam em um único arquivo
   (`src/lib/copaflix/catalogo.ts`) para troca fácil; os títulos com espelho
   trocam de fonte sem intervenção.
6. **Capa do Internet Archive** nem sempre existe para o item (aí entra a arte
   do app) e pode ser uma moldura do próprio filme, não o cartaz oficial. Para
   cartaz oficial de catálogo comercial é preciso TMDB (com chave e atribuição)
   ou Jellyfin.
7. **Novelas** não têm acervo de demonstração: novelas completas raramente são
   liberadas para distribuição gratuita. A aba mostra a explicação e passa a
   listar conteúdo assim que houver fonte autorizada (Jellyfin/catálogo).
8. **Área administrativa de fontes** não foi criada: a configuração é por
   variável de ambiente (mais simples e sem risco de alterar o painel atual).
   Se for necessário editar fontes pela web, o caminho natural é um cartão novo
   em `/admin` guardando as URLs cifradas no cofre já existente — mudança
   isolada, fora do escopo desta entrega.
9. **Roda 3D é um coverflow.** A capa em foco aparece inteira e as vizinhas
   aparecem em perspectiva nas laterais, cada vez mais estreitas — no celular
   (capa = 62% da largura) sobra um fio de cada lado, no desktop (30%) sobra
   mais. É recorte proposital do palco 3D, não rolagem horizontal: medido a
   390, 820 e 1440 px, `scrollWidth` fica igual à largura da janela. Os pontos
   abaixo da roda e o gesto de arrastar deixam claro que há mais capas.

---

## 8. Resultado dos testes nesta entrega

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | sem erros |
| `npm run lint` | 0 erros (7 avisos de `<img>` já existentes no projeto) |
| `npm test` | 576 testes · 553 passam · 22 pulados · **1 falha pré-existente** (`#ff4d4d` em `.led-vermelho` do `globals.css`, fora do CopaFlix) |
| `tests/copaflix.test.ts` | 37/37 passam |
| `npm run build` | sucesso; rotas `/copaflix`, `/copaflix/titulo/[id]` e `/api/copaflix/*` publicadas |
| Navegação `/` → ⋮ → Entretenimento | OK no servidor de desenvolvimento |
| Roda 3D (arrasto e teclado) | OK (headless Chromium 390 px e 1440 px) |
| Player com fonte indisponível | mensagem clara + "Tentar de novo" |
| Continuar assistindo / favoritos / histórico | persistindo e reaparecendo após recarregar |
| Hidratação (SSR × cliente) | sem avisos |

---

## 9. Reverter

O módulo é isolado. Para tirar a entrada do menu e voltar ao estado anterior
sem tocar no resto do app: remova o bloco `ENTRETENIMENTO` de
`src/components/inicio/MenuConta.tsx` (e os imports de ícones). A rota
`/copaflix` pode continuar publicada (não aparece em lugar nenhum) ou ser
apagada junto com `src/components/copaflix`, `src/lib/copaflix`,
`src/app/api/copaflix`, `src/app/copaflix` e a dependência `hls.js`.
