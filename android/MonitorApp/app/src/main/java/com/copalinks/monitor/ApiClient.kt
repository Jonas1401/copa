package com.copalinks.monitor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Só HTTPS para o domínio oficial; nenhum token vai em URL ou nos logs. */
object ApiClient {
    data class Result(val status: Int, val body: JSONObject) {
        val ok: Boolean get() = status in 200..299
        val message: String get() = body.optString("erro", if (ok) "OK" else "Falha HTTP $status")
    }

    suspend fun call(path: String, method: String = "POST", body: JSONObject? = null, secret: String? = null): Result = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/") && !path.contains(".."))
        val base = BuildConfig.API_BASE_URL.trimEnd('/')
        require(base.startsWith("https://"))
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            if (secret != null) connection.setRequestProperty("Authorization", "Bearer $secret")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            Result(status, try { JSONObject(text) } catch (_: Exception) { JSONObject() })
        } finally { connection.disconnect() }
    }
}
