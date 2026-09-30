package com.copalinks.monitor

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Dados FCM dirigidos SOMENTE ao receptor pareado. Nunca contém texto do WhatsApp. */
class CopaMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val secret = SecureStore(this).get("RECEIVER") ?: return
        scope.launch {
            try { ApiClient.call("/api/devices/register", body = JSONObject().put("action", "refresh").put("fcmToken", token), secret = secret) }
            catch (_: Exception) { /* Retenta na próxima abertura do app. */ }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val tipo = data["tipo"]
        if (tipo != "codigo_whatsapp" && tipo != "teste_monitor") return
        val codigo = if (tipo == "codigo_whatsapp") data["codigo"] ?: return else ""
        if (tipo == "codigo_whatsapp" && CodeMatcher.extract(codigo).singleOrNull() != codigo) return
        createChannel(this)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(this, codigo.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_monitor_notification)
            .setContentTitle(data["titulo"] ?: "CopaLinks · código monitorado")
            .setContentText(data["corpo"] ?: "Código $codigo detectado no WhatsApp")
            .setStyle(NotificationCompat.BigTextStyle().bigText(data["corpo"] ?: "Código $codigo detectado"))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pending)
            .build()
        NotificationManagerCompat.from(this).notify((data["evento"] ?: codigo).hashCode(), notification)
    }

    companion object {
        private const val CHANNEL = "codigos_copalinks"
        fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = context.getString(R.string.channel_description) })
        }
    }
}
