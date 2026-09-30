package com.copalinks.monitor

import java.security.MessageDigest
import java.util.Locale

/**
 * Grupo autorizado pelo dono: não monitorar outros grupos nem chats privados.
 * O nome fica somente neste Android e na configuração do servidor. Para a
 * API vai apenas um SHA-256, nunca o título, remetente ou corpo do WhatsApp.
 */
object MonitoredGroup {
    const val NAME = "INFO. OP PORTO / FOSPAR **"

    private fun normalized(name: String): String = name.trim()
        .replace(Regex("\\s+"), " ")
        .uppercase(Locale.ROOT)

    val fingerprint: String = MessageDigest.getInstance("SHA-256")
        .digest(normalized(NAME).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    /**
     * A confirmação da conversa vem dos metadados da notificação. O título
     * pode ser apenas o remetente, portanto só vale sozinho quando o Android
     * marcou explicitamente a conversa como GRUPO. Sem metadados, rejeita.
     */
    fun matches(conversationTitle: String?, subText: String?, title: String?, isGroupConversation: Boolean?): Boolean {
        if (isGroupConversation == false) return false
        if (!conversationTitle.isNullOrBlank()) return normalized(conversationTitle) == normalized(NAME)
        if (!subText.isNullOrBlank() && normalized(subText) == normalized(NAME)) return true
        if (isGroupConversation != true || title.isNullOrBlank()) return false
        val formattedTitle = normalized(title)
        // Algumas versões do WhatsApp exibem "remetente @ nome do grupo".
        // Aceita apenas a parte APÓS " @ " e só com flag de grupo explícita.
        return formattedTitle == normalized(NAME) ||
            formattedTitle.substringAfterLast(" @ ", "") == normalized(NAME)
    }
}
