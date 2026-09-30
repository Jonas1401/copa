package com.copalinks.monitor

/** Mesmo padrão da API: A/B/M + 001..999. Nunca retorna texto do WhatsApp. */
object CodeMatcher {
    private val pattern = Regex("(?<![\\p{L}\\p{N}])([ABM])\\s*[-–]?\\s*(\\d{1,3})(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)

    fun extract(message: String): List<String> {
        val found = linkedSetOf<String>()
        for (match in pattern.findAll(message.take(1000))) {
            val number = match.groupValues[2].toIntOrNull() ?: continue
            if (number in 1..999) found.add("${match.groupValues[1].uppercase()}$number")
            if (found.size >= 12) break
        }
        return found.toList()
    }
}
