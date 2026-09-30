package com.copalinks.monitor

import java.security.MessageDigest

/**
 * Filtro automático do grupo "INFO. OP PORTO / FOSPAR **".
 *
 * Pré-filtro LOCAL: só mensagens com as listas "PONTOS NA VEZ" ou
 * "... PULADAS" saem do aparelho. Conversas comuns do grupo não são enviadas.
 * A leitura dos códigos e a escolha de quem recebe o aviso ficam no servidor
 * (src/lib/grupo-filtro.ts), que compara o código completo com o ponto de
 * cada motorista e não grava o texto.
 */
object GroupMessageFilter {
    /** Mesmo limite do servidor (TEXTO_MAX em src/lib/grupo-filtro.ts). */
    const val MAX_TEXT = 12_000

    private val lists = Regex(
        "(?<![\\p{L}])(PONTOS?\\s+NA\\s+VEZ|PULAD[OA]S?)(?![\\p{L}])",
        RegexOption.IGNORE_CASE,
    )

    fun shouldForward(text: String?): Boolean = !text.isNullOrBlank() && lists.containsMatchIn(text)

    /** ID do evento: a mesma mensagem reapresentada pelo WhatsApp gera o mesmo ID. */
    fun eventId(notificationKey: String, messageTime: Long, text: String): String =
        sha256("grupo:$notificationKey:$messageTime:${sha256(text)}")

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
