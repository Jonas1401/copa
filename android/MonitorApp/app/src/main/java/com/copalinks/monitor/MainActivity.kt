package com.copalinks.monitor

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * App Android Monitor. O dono autoriza os serviços explicitamente. A senha do
 * aparelho fica no Keystore e a conversa do WhatsApp jamais fica nesta tela.
 */
class MainActivity : Activity() {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var store: SecureStore
    private lateinit var status: TextView
    private lateinit var monitorCode: EditText
    private lateinit var receiverCode: EditText
    private val navy = Color.rgb(1, 16, 30)
    private val card = Color.rgb(10, 31, 64)
    private val accent = Color.rgb(31, 193, 170)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore(this)
        CopaMessagingService.createChannel(this)
        drawUi()
    }

    private fun drawUi() {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 28, 22, 32)
            setBackgroundColor(navy)
        }
        fun text(value: String, size: Float = 15f, bold: Boolean = false): TextView = TextView(this).apply {
            this.text = value
            textSize = size
            setTextColor(Color.WHITE)
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 9, 0, 9)
        }
        fun button(value: String, action: () -> Unit): Button = Button(this).apply {
            text = value
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply { setColor(card); cornerRadius = 28f; setStroke(2, accent) }
            setOnClickListener { action() }
        }
        fun edit(hintValue: String): EditText = EditText(this).apply {
            hint = hintValue
            setSingleLine(true)
            textSize = 18f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.LTGRAY)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        content.addView(text("🚛 CopaLinks Monitor", 25f, true))
        content.addView(text("Grupo autorizado: ${MonitoredGroup.NAME}. Outros grupos e conversas privadas são ignorados. Só mensagens deste grupo com PONTOS NA VEZ ou PULADAS são enviadas ao CopaLinks, que avisa cada motorista apenas do próprio ponto. O texto não é guardado e o remetente nunca é enviado. Mantenha as notificações do WhatsApp ativadas neste aparelho.", 15f))
        status = text("", 14f)
        content.addView(status)

        content.addView(text("1 · Monitorar WhatsApp (aparelho do administrador)", 18f, true))
        content.addView(text("No site CopaLinks, abra /admin → Monitor WhatsApp → Gerar código do monitor. Digite-o abaixo. O Android vai pedir que você habilite Acesso a notificações: escolha CopaLinks Monitor conscientemente.", 14f))
        content.addView(button("Abrir Acesso a notificações no Android") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        monitorCode = edit("Código do monitor: XXXX-XXXX-XXXX")
        content.addView(monitorCode)
        content.addView(button("Ativar aparelho MONITOR") { pairMonitor() })

        content.addView(text("2 · Receber avisos FCM (celular do motorista)", 18f, true))
        content.addView(text("No seu perfil do site CopaLinks, vá à aba Sobre → Monitor WhatsApp, cadastre os códigos desejados e gere seu código do Android. Só códigos escolhidos por você disparam avisos neste celular.", 14f))
        receiverCode = edit("Código do receptor: XXXX-XXXX-XXXX")
        content.addView(receiverCode)
        content.addView(button("Ativar aparelho RECEPTOR") { pairReceiver() })
        content.addView(button("Abrir o CopaLinks no navegador") {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.API_BASE_URL)))
        })
        content.addView(text("Privacidade: capture apenas notificações com códigos necessários. Desative o Acesso a notificações em Configurações se quiser parar a captura. A permissão para exibir avisos FCM é independente.", 12f))
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        setContentView(scroll)
        refreshStatus()
    }

    private fun refreshStatus(message: String = "") {
        val access = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        status.text = listOf(
            "Acesso a notificações: ${if (access) "autorizado" else "não autorizado"}",
            "Monitor: ${if (store.get("MONITOR") != null) "pareado" else "não pareado"}",
            "Receptor: ${if (store.get("RECEIVER") != null) "pareado" else "não pareado"}",
            message,
        ).filter { it.isNotBlank() }.joinToString("\n")
    }

    private fun pairMonitor() {
        if (!NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)) {
            refreshStatus("Primeiro conceda Acesso a notificações no Android. Sem essa permissão não há captura.")
            return
        }
        val code = monitorCode.text.toString().trim()
        if (code.isBlank()) { refreshStatus("Digite o código do administrador."); return }
        scope.launch {
            try {
                val r = ApiClient.call("/api/devices/register", body = JSONObject().put("action", "pair")
                    .put("tipo", "MONITOR").put("codigo", code).put("nome", "Monitor Android"))
                if (r.ok) {
                    store.save("MONITOR", r.body.getString("deviceSecret"))
                    monitorCode.text.clear()
                    refreshStatus("Monitor ativado. Apenas códigos cadastrados serão encaminhados.")
                } else refreshStatus(r.message)
            } catch (_: Exception) { refreshStatus("Sem conexão com a API. Tente de novo.") }
        }
    }

    private fun pairReceiver() {
        val code = receiverCode.text.toString().trim()
        if (code.isBlank()) { refreshStatus("Digite o código gerado no seu perfil CopaLinks."); return }
        requestFcmPermission()
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful || task.result.isNullOrBlank()) {
                refreshStatus("Firebase indisponível. Confira o google-services.json e o Google Play Services.")
                return@addOnCompleteListener
            }
            scope.launch {
                try {
                    val r = ApiClient.call("/api/devices/register", body = JSONObject().put("action", "pair")
                        .put("tipo", "RECEIVER").put("codigo", code).put("nome", "Celular Android")
                        .put("fcmToken", task.result))
                    if (r.ok) {
                        store.save("RECEIVER", r.body.getString("deviceSecret"))
                        receiverCode.text.clear()
                        refreshStatus("Receptor ativado para os códigos deste motorista.")
                    } else refreshStatus(r.message)
                } catch (_: Exception) { refreshStatus("Sem conexão com a API. Tente de novo.") }
            }
        }
    }

    private fun requestFcmPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshStatus()
        val secret = store.get("RECEIVER") ?: return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            scope.launch {
                try { ApiClient.call("/api/devices/register", body = JSONObject().put("action", "refresh").put("fcmToken", token), secret = secret) }
                catch (_: Exception) { /* Retenta na próxima abertura. */ }
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
