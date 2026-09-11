package com.menote.p2p

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * 前台服务：保活 iroh QUIC 连接与本地代理。
 * Android 后台限制下，只有前台服务能维持长连接与 accept 循环。
 */
class ProxyService : Service() {

    companion object {
        const val CHANNEL_ID = "menote_p2p"
        const val NOTIFICATION_ID = 1
        const val EXTRA_SERVER_ID = "server_id"
        const val EXTRA_PORT = "port"

        @Volatile
        var proxy: IrohProxy? = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverId = intent?.getStringExtra(EXTRA_SERVER_ID)
        val port = intent?.getIntExtra(EXTRA_PORT, 3107) ?: 3107

        if (serverId.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        // 已在运行且配置相同：跳过（防重复 startService 误重启隧道）
        val existing = proxy
        if (existing != null && existing.serverNodeId == serverId) {
            MainActivity.appendLog("（隧道已在运行，忽略重复启动请求）")
            return START_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification("正在启动 P2P 隧道…"))

        // 停旧实例（配置变化才走到这里）
        proxy?.stop()

        val keyFile = java.io.File(filesDir, "p2p-node-secret.bin")
        val p = IrohProxy(serverId, port, keyFile)
        proxy = p
        // 状态日志：Service 与 MainActivity 共用的全局缓冲广播
        p.onStateChange = { msg ->
            MainActivity.appendLog(msg)
            updateNotification(msg)
        }
        p.onNodeIdReady = { id ->
            MainActivity.appendLog("   本机节点 ID: $id")
            MainActivity.publishNodeId(id)
        }
        p.start()

        return START_STICKY
    }

    override fun onDestroy() {
        proxy?.stop()
        proxy = null
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "MeNote P2P 隧道",
                NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "维持与家里电脑的 P2P 连接"
            ch.setShowBadge(false)
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String): Notification {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MeNote")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pending)          // 点击通知 → 打开主界面
            .setAutoCancel(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
