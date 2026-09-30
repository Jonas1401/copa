package com.copalinks.monitor

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Requer o usuário conceder Acesso a notificações nas Configurações do Android.
 * Lê as NOTIFICAÇÕES que o Android recebe (não acessa o WhatsApp): sem
 * notificação publicada pelo WhatsApp, não há o que ler. Apenas WhatsApp /
 * WhatsApp Business e apenas o grupo autorizado (MonitoredGroup).
 *  - Fluxo de códigos: extrai LOCALMENTE e envia só "A184 B22".
 *  - Filtro do grupo: mensagens com "PONTOS NA VEZ" ou "... PULADAS" têm o
 *    texto da mensagem enviado ao CopaLinks para o filtro; o servidor não
 *    grava o texto. Nunca envia remetente, contato ou mídia.
 */
class WhatsAppNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var cache = emptySet<String>()
    private var syncedAt = 0L
    private val allowed = setOf("com.whatsapp", "com.whatsapp.w4b")

    override fun onListenerConnected() {
        super.onListenerConnected()
        scope.launch { refreshCodes() }
    }

    private suspend fun refreshCodes() {
        val secret = SecureStore(this).get("MONITOR") ?: return
        if (System.currentTimeMillis() - syncedAt < 60_000L) return
        val result = try { ApiClient.call("/api/codes", method = "GET", secret = secret) } catch (_: Exception) { return }
        if (!result.ok) return
        val arr = result.body.optJSONArray("codigos") ?: return
        val codes = mutableSetOf<String>()
        for (i in 0 until arr.length()) arr.optString(i)?.let { if (it.isNotBlank()) codes.add(it) }
        cache = codes
        syncedAt = System.currentTimeMillis()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        if (notification.packageName !in allowed) return
        if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (SecureStore(this).get("MONITOR") == null) return

        val extras = notification.notification.extras ?: return
        // Em notificações de grupo, WhatsApp pode trazer o nome em
        // conversationTitle ou subText; EXTRA_TITLE pode ser só o remetente.
        // Sem confirmação de grupo, falha fechado para não capturar um contato
        // privado ou outra conversa com um código parecido.
        val groupFlag = if (extras.containsKey(Notification.EXTRA_IS_GROUP_CONVERSATION))
            extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION) else null
        if (!MonitoredGroup.matches(
                extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString(),
                extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
                extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
                groupFlag,
            )) return

        // MessagingStyle pode carregar dezenas de mensagens antigas. Varra só
        // a ÚLTIMA da notificação atual, jamais o histórico inteiro; nos outros
        // estilos, prefira a última linha ou o texto visível da notificação.
        val messageBundles = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        val content = if (messageBundles != null) {
            (messageBundles.lastOrNull() as? Bundle)?.getCharSequence("text")?.toString().orEmpty()
        } else {
            extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.lastOrNull()?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        }
        if (content.isBlank()) return

        // Filtro automático "PONTOS NA VEZ" / "PULADAS": só estas listas do
        // grupo autorizado vão ao CopaLinks, que avisa cada motorista do próprio
        // ponto. Independe do fluxo de códigos abaixo, que continua igual.
        if (GroupMessageFilter.shouldForward(content)) {
            val groupText = content.take(GroupMessageFilter.MAX_TEXT)
            val groupTime = (messageBundles?.lastOrNull() as? Bundle)?.getLong("time", 0L)
                ?.takeIf { it > 0L } ?: notification.postTime
            val groupEvent = GroupMessageFilter.eventId(notification.key, groupTime, groupText)
            val groupSource = notification.packageName
            scope.launch { forwardGroupMessage(groupEvent, groupSource, groupText) }
        }

        // O texto só existe em memória neste callback; para a API vão códigos.
        val matches = CodeMatcher.extract(content)
        if (matches.isEmpty()) return
        val sourcePackage = notification.packageName
        val latestMessageTime = (messageBundles?.lastOrNull() as? Bundle)?.getLong("time", 0L)
            ?.takeIf { it > 0L } ?: notification.postTime
        val eventSource = "${notification.key}:$latestMessageTime:${matches.joinToString(",")}"
        val eventId = MessageDigest.getInstance("SHA-256")
            .digest(eventSource.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        scope.launch {
            refreshCodes()
            val selected = matches.filter { it in cache }
            if (selected.isEmpty()) return@launch
            val secret = SecureStore(this@WhatsAppNotificationListener).get("MONITOR") ?: return@launch
            val payload = JSONObject().put("eventId", eventId).put("origem", sourcePackage)
                .put("grupoHash", MonitoredGroup.fingerprint)
                .put("message", selected.joinToString(" "))
            try { ApiClient.call("/api/monitor/messages", body = payload, secret = secret) }
            catch (_: Exception) { /* Sem rede: novo evento será processado quando o Android o entregar. */ }
        }
    }

    /**
     * Envia a mensagem do grupo para o filtro do servidor (/api/monitor/grupo).
     * Tenta de novo em falha de rede ou erro temporário do servidor; o mesmo
     * eventId garante que o motorista não recebe o aviso em dobro.
     */
    private suspend fun forwardGroupMessage(eventId: String, source: String, text: String) {
        val secret = SecureStore(this).get("MONITOR") ?: return
        val payload = JSONObject().put("eventId", eventId).put("origem", source)
            .put("grupoHash", MonitoredGroup.fingerprint)
            .put("texto", text)
        for (wait in longArrayOf(0L, 3_000L, 10_000L)) {
            if (wait > 0L) delay(wait)
            val status = try {
                ApiClient.call("/api/monitor/grupo", body = payload, secret = secret).status
            } catch (_: Exception) { -1 }
            // Entregue (2xx) ou recusado de vez (4xx exceto 429): não repete.
            if (status in 200..299 || (status in 400..499 && status != 429)) return
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
