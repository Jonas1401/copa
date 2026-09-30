# CopaLinks Monitor — Android (Kotlin)

Este módulo **não substitui o app web**. É um acompanhante nativo para:
1. Monitor autorizado captar somente notificações de `com.whatsapp` e `com.whatsapp.w4b` do grupo `INFO. OP PORTO / FOSPAR **` que contenham códigos ativos A/B/M;
2. Receptores pareados receberem pelo Firebase somente avisos dos códigos que cadastraram no CopaLinks.

**Privacidade:** NotificationListenerService é uma permissão ampla do Android, concedida pelo usuário nas Configurações. O código restringe pacote **e nome exato do grupo** (ignorando apenas maiúsculas/minúsculas e espaços repetidos) antes de examinar a mensagem mais recente. Ignora grupos parecidos, conversas privadas e notificações sem metadados que confirmem o grupo. Extrai códigos em memória e envia **somente códigos e um hash do nome do grupo**; não armazena/envia conversa completa, título do grupo, remetente, contato, áudio ou mídia. Se o WhatsApp não mostrar o grupo e o conteúdo na notificação, o monitor não consegue reconhecer o código e não envia nada. Revogue a permissão nas Configurações para parar a captura. Não use sem o consentimento do dono do aparelho e das pessoas afetadas.

## Preparar no Firebase (ação do dono da conta)

1. Acesse [console.firebase.google.com](https://console.firebase.google.com/) e crie/selecione um projeto. Adicione **um app Android** com package name exato `com.copalinks.monitor`.
2. Baixe **google-services.json** e coloque SOMENTE em `android/MonitorApp/app/google-services.json`. O Git o ignora. Essa configuração é do cliente; **NUNCA** ponha a chave privada da conta de serviço no Android.
3. Em **Project settings → Service accounts**, gere uma **chave de conta de serviço** para o servidor. No projeto Vercel **copa-links → Settings → Environment Variables**, configure `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON inteiro como variável privada de Production/Preview; redeploy. Não envie o JSON no chat nem para o GitHub. Se tiver que rotacionar, gere outra chave e revogue a anterior.
4. O app Android receptor usa Google Play Services compatível. O navegador/PWA usa o Web Push existente e NÃO precisa do Firebase para esses avisos.

## Abrir e compilar

Abra `android/MonitorApp` no Android Studio com **JDK 17+** e Android SDK 35. O Gradle Wrapper está incluído; conecte um aparelho com Android 8+ e Google Play Services e use **Run**. O projeto não contém `google-services.json` nem APK assinado; sem o passo anterior, a tarefa Gradle do Firebase falha intencionalmente.

## Ativar, com sua autorização

1. No site **copa-links.vercel.app/admin → Monitor WhatsApp**, admin gera código temporário (10 min, uso único). O aparelho monitor precisa estar no grupo **`INFO. OP PORTO / FOSPAR **`** com as notificações do WhatsApp desse grupo habilitadas e identificadas pelo Android. No Android monitor, toque **Abrir Acesso a notificações no Android**, selecione CopaLinks Monitor e então digite o código no campo MONITOR. Sem essa permissão ou sem título de grupo identificável na notificação, o serviço não lê/encaminha nada.
2. Cada motorista abre o site CopaLinks no seu próprio aparelho, em **Sobre → Monitor WhatsApp**, cadastra códigos (ex.: A184) e gera código do Android. No Android receptor, digite esse código em RECEPTOR e conceda permissão de **mostrar notificações** (Android 13+).
3. Um mesmo APK pode ser monitor e receptor, mas os pareamentos são independentes. O monitor verifica os códigos ativos no servidor; nenhum nome ou ID de motorista é transferido para o monitor. As credenciais de dispositivo ficam no Android Keystore; o banco guarda somente o hash.
4. No dashboard admin veja aparelhos e eventos recentes. Em **Sobre → Monitor WhatsApp**, depois do pareamento, toque **Testar Firebase** ao lado do seu próprio aparelho receptor: o servidor envia no máximo um teste por minuto para esse aparelho, sem código WhatsApp. **FCM aceito** quer dizer que o Firebase aceitou a requisição, não que o Android exibiu a notificação; confirme no aparelho real e libere as notificações do Android.

Apenas notificações **novas** do WhatsApp podem ser capturadas. O monitor não lê histórico/conversas; notificações ocultas, silenciadas ou resumidas sem código não geram evento. Cadastre os códigos conscientemente; nenhum envio é feito ao WhatsApp. Pode haver custos/limites do Firebase conforme seu plano.


## Filtro automático do grupo (PONTOS NA VEZ / PULADAS)

A partir desta versão, o aparelho **MONITOR** também envia a
`/api/monitor/grupo` as mensagens do grupo `INFO. OP PORTO / FOSPAR **` que
contenham **PONTOS NA VEZ** ou **PULADAS** (`GroupMessageFilter.kt`). O
servidor identifica os códigos e avisa cada motorista **só do próprio ponto**
pelo Web Push do CopaLinks — o motorista não precisa do app Android, basta ter
ativado as notificações no CopaLinks. O Firebase não é necessário para isso.

Para ativar: gere o APK novo como descrito acima (Android Studio → Run,
com o `google-services.json` local), instale por cima no aparelho monitor
(o pareamento é mantido) e
confira em Configurações → Notificações → Acesso a notificações que o
**CopaLinks Monitor** continua autorizado. Mantenha as notificações do
WhatsApp ativadas nesse aparelho.
