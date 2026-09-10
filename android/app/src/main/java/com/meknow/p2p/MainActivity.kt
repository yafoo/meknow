package com.meknow.p2p

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * 配置页：输入服务器（电脑）节点 ID，启动/停止隧道，跳转 WebView。
 * 本机节点 ID 展示在页面下方 —— 用 `pair.js --add` 登记到电脑端白名单完成配对。
 * 底部日志面板：代理内部状态实时滚动，方便真机调试。
 *
 * 按钮状态机：启动中禁用防重复；运行中「启动隧道」变「停止隧道」。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var serverIdInput: EditText
    private lateinit var connStateBadge: TextView
    private lateinit var myIdText: TextView
    private lateinit var startBtn: Button
    private lateinit var openBtn: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** 扫码启动器：结果回填到节点 ID 输入框 */
    private val scanLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if(result.resultCode == RESULT_OK) {
                val scanned = result.data?.getStringExtra(ScanActivity.EXTRA_RESULT)
                if(!scanned.isNullOrBlank()) {
                    // 识别成功：hex(64) 统一转 base32(52) —— 与服务端白名单编码一致
                    val id = if(scanned.length == 64 && scanned.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) {
                        IrohProxy.hexToBase32Id(
                            scanned.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                        )
                    } else scanned
                    serverIdInput.setText(id)
                    pref.edit().putString("serverId", id).apply()
                    MainActivity.appendLog("扫码识别节点 ID: $id")
                    Toast.makeText(this, "已填入节点 ID", Toast.LENGTH_SHORT).show()
                }
            }
        }

    private val pref by lazy { getSharedPreferences("p2p", MODE_PRIVATE) }

    // 状态轮询：服务启动是异步的，节点 ID / 连接状态就绪时刷新界面
    private val uiPoller = android.os.Handler(android.os.Looper.getMainLooper())
    private val pollTask = object : Runnable {
        override fun run() {
            refreshStatus()
            uiPoller.postDelayed(this, 1000)
        }
    }

    /** 全局日志缓冲：ProxyService 与本页共用，跨页面可见 */
    companion object {
        private val logBuffer = StringBuilder()
        @Volatile
        private var logListener: ((String) -> Unit)? = null
        /** 本机节点 ID 广播（IrohProxy bind 完成时一次性触发） */
        @Volatile
        private var nodeIdListener: ((String) -> Unit)? = null
        /** 最近一次广播的节点 ID：Activity 重建（旋转/重开）时补显示 */
        @Volatile
        private var lastNodeId: String? = null

        private fun timestamp(): String =
            java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())

        fun appendLog(msg: String) {
            val line = "[${timestamp()}] $msg"
            synchronized(logBuffer) {
                if (logBuffer.length > 40_000) logBuffer.setLength(0)
                logBuffer.appendLine(line)
            }
            logListener?.invoke(line)
        }

        /** ProxyService 调用：ID 就绪广播（一次） */
        fun publishNodeId(id: String) {
            if(id.isBlank()) return
            lastNodeId = id
            nodeIdListener?.invoke(id)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        computer.iroh.IrohAndroid.installAndroidContext(applicationContext)

        serverIdInput = findViewById(R.id.serverIdInput)
        connStateBadge = findViewById(R.id.connStateBadge)
        myIdText = findViewById(R.id.myIdText)
        startBtn = findViewById(R.id.startBtn)
        openBtn = findViewById(R.id.openBtn)
        logView = findViewById(R.id.logView)
        logScroll = findViewById(R.id.logScroll)

        // 本机节点 ID 点击复制到剪贴板
        myIdText.setOnClickListener {
            val id = myIdText.text.toString().trim()
            if(id.isNotEmpty()) {
                val cm = getSystemService(android.content.ClipboardManager::class.java)
                cm.setPrimaryClip(android.content.ClipData.newPlainText("nodeId", id))
                Toast.makeText(this, "已复制节点 ID", Toast.LENGTH_SHORT).show()
            }
        }

        // 回填历史配置
        serverIdInput.setText(pref.getString("serverId", ""))

        // 扫码按钮（输入框右侧独立按钮，48dp 触控目标）
        findViewById<android.widget.ImageButton>(R.id.scanBtn).setOnClickListener {
            scanLauncher.launch(Intent(this, ScanActivity::class.java))
        }

        // 通知权限（Android 13+）
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        startBtn.setOnClickListener {
            // 运行中点击 = 停止（按钮文案由 refreshStatus 切换）
            val runningProxy = ProxyService.proxy
            if (runningProxy != null) {
                appendLog("---- 停止隧道 ----")
                stopService(Intent(this, ProxyService::class.java))
                startBtn.text = "启动隧道"
                return@setOnClickListener
            }

            val serverId = serverIdInput.text.toString().trim()
            if (serverId.isEmpty()) {
                Toast.makeText(this, "请输入服务器节点 ID", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            pref.edit().putString("serverId", serverId).apply()

            appendLog("---- 启动隧道 ----")
            appendLog("服务器节点 ID: $serverId")

            val intent = Intent(this, ProxyService::class.java).apply {
                putExtra(ProxyService.EXTRA_SERVER_ID, serverId)
                putExtra(ProxyService.EXTRA_PORT, 8080)
            }
            ContextCompat.startForegroundService(this, intent)
            startBtn.isEnabled = false
        }

        openBtn.setOnClickListener {
            val serverId = serverIdInput.text.toString().trim()
            if (serverId.isEmpty()) {
                Toast.makeText(this, "请先填服务器节点 ID", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (ProxyService.proxy == null) {
                Toast.makeText(this, "隧道未启动", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            startActivity(Intent(this, WebActivity::class.java))
        }

        // 顶部同一个按钮承担 启动/停止（见 refreshStatus 切换文案）
        startBtn.setOnLongClickListener {
            // 长按强制停止（普通点击在运行中即变停止，无需长按；留个保险）
            if (ProxyService.proxy != null) {
                appendLog("---- 停止隧道 ----")
                stopService(Intent(this, ProxyService::class.java))
                true
            } else false
        }

        // 日志监听（state: 内部事件不进日志面板，只驱动状态）
        logListener = { msg ->
            if (!msg.startsWith("state:")) {
                runOnUiThread {
                    logView.append(msg + "\n")
                    logScroll.post { logScroll.fullScroll(ScrollView.FOCUS_DOWN) }
                }
            }
        }
        // 本机节点 ID：一次性显示 + Activity 重建时补显示（不进 1s 轮询，
        // 避免每秒重写文本打断复制；标签行在布局里，值行只放纯 ID）
        nodeIdListener = { id ->
            runOnUiThread { myIdText.text = id }
        }
        lastNodeId?.let { myIdText.text = it }
        // 恢复历史日志 + 允许长按选择复制
        synchronized(logBuffer) { logView.text = logBuffer.toString() }
        logView.setTextIsSelectable(true)

        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        uiPoller.post(pollTask)
    }

    override fun onPause() {
        super.onPause()
        uiPoller.removeCallbacks(pollTask)
    }

    override fun onDestroy() {
        super.onDestroy()
        uiPoller.removeCallbacks(pollTask)
        if (isFinishing) {
            logListener = null
            nodeIdListener = null
        }
    }

    /**
     * 实时刷新：标题右侧徽标（状态+连接方式）、按钮文案与可用性（每秒 + 事件驱动）。
     * 本机节点 ID 不在此刷新（一次性广播，见 publishNodeId）。
     */
    private fun refreshStatus() {
        val p = ProxyService.proxy
        if (p == null) {
            updateBadge("未启动", "#999999")
            startBtn.text = "启动隧道"
            startBtn.isEnabled = serverIdInput.text.toString().isNotBlank()
        } else {
            // 刷新连接方式（打洞成功 relay→直连 的切换由每秒轮询捕获）
            p.refreshConnPath()
            val (text, color) = when (p.state) {
                IrohProxy.State.STARTING -> "启动中" to "#999999"
                IrohProxy.State.CONNECTING -> "连接中" to "#E6A23C"
                IrohProxy.State.READY ->
                    if(p.connPath == "p2p") "已连接 · P2P" to "#67C23A"
                    else "已连接 · 中继" to "#409EFF"
                IrohProxy.State.RECONNECTING -> "重连中" to "#E6A23C"
                IrohProxy.State.STOPPED -> "已停止" to "#909399"
            }
            updateBadge(text, color)
            // 启动/运行中按钮变为停止，可点击；未启动恢复
            startBtn.text = "停止隧道"
            startBtn.isEnabled = true
        }
    }

    /** 徽标：文字 + 圆点色（简单用 HTML color 着色文本） */
    private fun updateBadge(text: String, colorHex: String) {
        connStateBadge.text = text
        connStateBadge.setTextColor(android.graphics.Color.parseColor(colorHex))
    }
}
