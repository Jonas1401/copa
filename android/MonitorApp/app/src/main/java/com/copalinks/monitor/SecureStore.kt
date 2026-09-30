package com.copalinks.monitor

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credenciais do monitor/receptor cifradas por uma chave não exportável do Android Keystore. */
class SecureStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("copalinks_monitor", Context.MODE_PRIVATE)
    private val alias = "copalinks_monitor_device_v1"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return gen.generateKey()
    }

    fun save(role: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val cipherText = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(role, Base64.encodeToString(cipher.iv + cipherText, Base64.NO_WRAP)).apply()
    }

    fun get(role: String): String? {
        return try {
            val encoded = prefs.getString(role, null) ?: return null
            val raw = Base64.decode(encoded, Base64.NO_WRAP)
            if (raw.size < 13) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    fun clear(role: String) { prefs.edit().remove(role).apply() }
}
