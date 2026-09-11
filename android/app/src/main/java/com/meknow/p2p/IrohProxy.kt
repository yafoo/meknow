package com.menote.p2p

import computer.iroh.Connection
import computer.iroh.Endpoint
import computer.iroh.EndpointAddr
import computer.iroh.EndpointId
import computer.iroh.EndpointOptions
import computer.iroh.RecvStream
import computer.iroh.SendStream
import io.ktor.http.Headers
import io.ktor.http.HeadersBuilder
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.BufferedOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean

/**
 * HTTP 消息的纯数据结构表示（io.ktor.http）—— 与 Socket 无关，
 * 用于自定义传输层（QUIC 双向流）上的 HTTP/1.1 映射。
 */
data class HttpExchange(
    val method: HttpMethod,
    val path: String,
    val headers: Headers,
    val body: ByteArray,
    val keepAlive: Boolean
)

/**
 * HTTP/1.1 ↔ HttpExchange 编解码器：
 *   - parseRequest:  InputStream → HttpExchange（解析请求行/头/定长 body）
 *   - parseResponse: ByteArray   → HttpResponseData（解析服务端响应）
 *   - buildRequest/Response:     数据结构 → 明文 HTTP/1.1 字节
 *
 * 解析字节流定位（找 \r\n\r\n、按行拆头）是传输层粘合代码，
 * 但产出物全部是 io.ktor.http 的纯数据结构（HttpMethod/Headers/StatusCode/ContentType），
 * 后续替换传输层或升级解析器时数据结构不变。
 */
object HttpCodec {
    private const val MAX_HEAD = 1 shl 20

    fun parseRequest(input: InputStream): HttpExchange? {
        val head = readHead(input) ?: return null
        val headStr = String(head, Charsets.ISO_8859_1)
        val lines = headStr.split("\r\n")
        val requestLine = lines.firstOrNull() ?: return null
        val parts = requestLine.split(' ')
        if(parts.size < 2) return null
        val method = HttpMethod(parts[0])
        val path = parts[1]

        val hb = HeadersBuilder()
        for(i in 1 until lines.size) {
            val line = lines[i]
            val c = line.indexOf(':')
            if(c > 0) {
                hb.append(line.substring(0, c).trim(), line.substring(c + 1).trim())
            }
        }
        val headers = hb.build()

        val contentLength = headers[io.ktor.http.HttpHeaders.ContentLength]?.toIntOrNull() ?: 0
        val body = if(contentLength > 0) {
            val buf = ByteArray(contentLength)
            var off = 0
            while(off < contentLength) {
                val n = input.read(buf, off, contentLength - off)
                if(n < 0) return null
                off += n
            }
            buf
        } else ByteArray(0)

        val connectionHeader = headers[io.ktor.http.HttpHeaders.Connection]?.lowercase()
        val keepAlive = when {
            connectionHeader?.contains("close") == true -> false
            connectionHeader?.contains("keep-alive") == true -> true
            else -> true  // HTTP/1.1 默认 keep-alive
        }
        return HttpExchange(method, path, headers, body, keepAlive)
    }

    /** 解析服务端响应（服务端返回的原始字节 → 数据结构） */
    fun parseResponse(bytes: ByteArray): HttpResponseData? {
        val sepIdx = indexOfDoubleCrlf(bytes) ?: return null
        val headStr = String(bytes, 0, sepIdx, Charsets.ISO_8859_1)
        val lines = headStr.split("\r\n")
        val statusLine = lines.firstOrNull() ?: return null
        val sp = statusLine.split(' ')
        if(sp.size < 2) return null
        val statusCode = sp[1].toIntOrNull() ?: return null

        val hb = HeadersBuilder()
        for(i in 1 until lines.size) {
            val line = lines[i]
            val c = line.indexOf(':')
            if(c > 0) {
                hb.append(line.substring(0, c).trim(), line.substring(c + 1).trim())
            }
        }
        val body = bytes.copyOfRange(sepIdx + 4, bytes.size)
        return HttpResponseData(HttpStatusCode.fromValue(statusCode), hb.build(), body)
    }

    /** HttpExchange → 明文 HTTP/1.1 请求字节（统一 Connection: close 保证单流单请求）。
     *  跳过 Connection / Content-Length / Transfer-Encoding —— body 已单独拼接，
     *  透传会造成双 Content-Length 头（Node parser 直接 400，POST 全挂的根因）。 */
    fun buildRequest(ex: HttpExchange): ByteArray {
        val sb = StringBuilder()
        sb.append(ex.method.value).append(' ').append(ex.path).append(" HTTP/1.1\r\n")
        var hasHost = false
        ex.headers.forEach { name, values ->
            for(v in values) {
                val lower = name.lowercase()
                when(lower) {
                    "connection", "content-length", "transfer-encoding" -> { /* 自己生成 */ }
                    else -> {
                        if(lower == "host") hasHost = true
                        sb.append(name).append(": ").append(v).append("\r\n")
                    }
                }
            }
        }
        if(!hasHost) sb.append("Host: 127.0.0.1\r\n")
        sb.append("Connection: close\r\n")
        sb.append("Content-Length: ").append(ex.body.size).append("\r\n")
        sb.append("\r\n")
        return sb.toString().toByteArray(Charsets.ISO_8859_1) + ex.body
    }

    /** HttpResponseData → 明文 HTTP/1.1 响应字节（写回 WebView 连接） */
    fun buildResponse(resp: HttpResponseData): ByteArray {
        val sb = StringBuilder()
        sb.append("HTTP/1.1 ").append(resp.status.value).append(' ')
            .append(resp.status.description ?: "").append("\r\n")
        var hasLength = false
        resp.headers.forEach { name, values ->
            for(v in values) {
                if(!name.equals("Connection", ignoreCase = true) &&
                   !name.equals("Transfer-Encoding", ignoreCase = true)) {
                    if(name.equals("Content-Length", ignoreCase = true)) hasLength = true
                    sb.append(name).append(": ").append(v).append("\r\n")
                }
            }
        }
        if(!hasLength) sb.append("Content-Length: ").append(resp.body.size).append("\r\n")
        sb.append("Connection: close\r\n")
        sb.append("\r\n")
        return sb.toString().toByteArray(Charsets.ISO_8859_1) + resp.body
    }

    private fun readHead(input: InputStream): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val probe = ByteArray(4)
        while(true) {
            val b = input.read()
            if(b < 0) return null
            out.write(b)
            val n = out.size()
            if(n >= 4) {
                val snapshot = out.toByteArray()
                System.arraycopy(snapshot, n - 4, probe, 0, 4)
                if(probe[0] == '\r'.code.toByte() && probe[1] == '\n'.code.toByte() &&
                   probe[2] == '\r'.code.toByte() && probe[3] == '\n'.code.toByte()) {
                    return snapshot.copyOfRange(0, n - 4)
                }
            }
            if(n > MAX_HEAD) return null
        }
    }

    private fun indexOfDoubleCrlf(bytes: ByteArray): Int? {
        val needle = "\r\n\r\n".toByteArray(Charsets.ISO_8859_1)
        outer@ for(i in 0..bytes.size - needle.size) {
            for(j in needle.indices) {
                if(bytes[i + j] != needle[j]) continue@outer
            }
            return i
        }
        return null
    }
}

/** 服务端响应数据结构（解析后） */
data class HttpResponseData(
    val status: HttpStatusCode,
    val headers: Headers,
    val body: ByteArray
)

// 便捷响应构造（写错误页给 WebView）
fun simpleResponse(status: HttpStatusCode, text: String): HttpResponseData {
    val body = text.toByteArray(Charsets.UTF_8)
    return HttpResponseData(
        status,
        Headers.build {
            append("Content-Type", "text/plain; charset=utf-8")
        },
        body
    )
}

/**
 * P2P 代理核心：
 *   WebView → 本地 ServerSocket (127.0.0.1:8080) → iroh QUIC 双向流（ALPN iroh-http/2）
 *   → 电脑端 menote lib/p2p.js → jj.js 应用栈 → MeNote。
 *
 * - 每个 HTTP 请求独占一条 QUIC 双向流；QUIC 连接级复用
 * - 连接失败/断线：无限自动重连（配对后无需重启隧道——电脑端白名单实时生效）
 * - 节点密钥持久化到 filesDir —— 本机节点 ID 固定，配对一次长期有效
 * - HTTP 解析/生成走 io.ktor.http 纯数据结构（HttpCodec）
 *
 * 状态机: start() 只接受一次；运行期间重复调用（重复点按钮）会被忽略。
 */
class IrohProxy(
    val serverNodeId: String,
    private val port: Int = 8080,
    private val keyStorePath: java.io.File? = null
) {
    companion object {
        /**
         * 与电脑端 lib/p2p.js 对齐的 ALPN。
         */
        val ALPN: ByteArray = "menote-p2p/1".toByteArray(Charsets.UTF_8)
        private const val TAG = "IrohProxy"
        private const val RETRY_INTERVAL_MS = 5000L
        /** 重连退避上限：连续失败越多间隔越长（5s→10s→20s→40s→60s 封顶） */
        private const val RETRY_BACKOFF_MAX_MS = 60_000L
        /** 单次 QUIC 交换（写请求+收响应）总超时：连接静默死亡时防止 readToEnd 永挂 */
        private const val REQUEST_TIMEOUT_MS = 30_000L
        /** 等待重连完成的上限 */
        private const val RECONNECT_WAIT_MS = 15_000L
        private val B32 = "abcdefghijklmnopqrstuvwxyz234567"

        /** 32 字节公钥 → base32(52 字符)，与 iroh 网络层节点 ID 编码一致 */
        fun hexToBase32Id(bytes: ByteArray): String {
            val sb = StringBuilder()
            var v = 0
            var n = 0
            for (b in bytes) {
                v = (v shl 8) or (b.toInt() and 0xFF)
                n += 8
                while (n >= 5) {
                    n -= 5
                    sb.append(B32[(v ushr n) and 31])
                }
            }
            if (n > 0) sb.append(B32[(v shl (5 - n)) and 31])
            return sb.toString()
        }
    }

    /** 代理生命周期 scope；stop() 时整体取消，所有协程与 socket 一并清理 */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var endpoint: Endpoint? = null
    private var serverSocket: ServerSocket? = null
    private val running = AtomicBoolean(false)
    private val connMutex = Mutex()

    @Volatile
    private var cachedConn: Connection? = null

    /** 连接监视器（断线检测 + 自动重连循环） */
    private var watchdog: Job? = null

    var onStateChange: ((String) -> Unit)? = null
    /** 节点 ID 就绪回调（bind 完成后触发，界面立即显示） */
    var onNodeIdReady: ((String) -> Unit)? = null
    var nodeId: String? = null
        private set

    /** 生命周期状态：连接是否可用（含重连中） */
    enum class State { STARTING, CONNECTING, READY, RECONNECTING, STOPPED }
    @Volatile
    var state: State = State.STOPPED
        private set

    /** 本地代理是否可开始收请求（serverSocket 已监听） */
    @Volatile
    var isReady: Boolean = false
        private set

    /**
     * 当前连接方式："p2p"=UDP 直连（打洞成功）/ "relay"=中继转发 / ""=未连接。
     * 由连接的 isSelected 路径判断（PathSnapshot.isRelay）。
     */
    @Volatile
    var connPath: String = ""
        private set

    /** 刷新 connPath（连接成功/断开/路径切换时调用；MainActivity 状态轮询也调） */
    fun refreshConnPath() {
        val conn = cachedConn ?: run { connPath = ""; return }
        try {
            val selected = conn.paths().firstOrNull { it.isSelected }
                ?: conn.paths().firstOrNull()
            connPath = when {
                selected == null -> ""
                selected.isRelay -> "relay"
                else -> "p2p"
            }
        } catch(_: Exception) {
            connPath = ""
        }
    }

    private fun setState(s: State) {
        state = s
        onStateChange?.invoke("state:${s.name}")
    }

    private fun log(msg: String) {
        android.util.Log.d(TAG, msg)
        onStateChange?.invoke(msg)
    }

    /**
     * 启动代理。幂等：已启动（含连接中/重连中）时直接忽略，
     * 避免重复点「启动」造成的停旧建新与端口竞争。
     */
    fun start() {
        if (running.getAndSet(true)) {
            log("（已在运行中，忽略重复启动）")
            return
        }
        val t0 = System.currentTimeMillis()
        scope.launch {
            try {
                setState(State.STARTING)
                // 1. 启动 iroh 端点（身份密钥持久化：节点 ID 固定）
                log("① 正在启动 iroh 节点…")
                val nodeSecret = loadOrCreateNodeSecret()
                val opts = EndpointOptions(
                    secretKey = nodeSecret,
                    alpns = listOf(ALPN)
                )
                val ep = Endpoint.bind(opts)
                endpoint = ep
                val myId = ep.id()
                // iroh-ffi 的 toString() 返回 hex(64)；统一转为 base32(52) ——
                // 与 iroh 网络层/电脑端 p2p.js 的节点 ID 编码一致，配对不再踩编码坑
                nodeId = hexToBase32Id(myId.toBytes())
                onNodeIdReady?.invoke(nodeId ?: "")
                log("① iroh 节点已启动（${System.currentTimeMillis() - t0}ms）")
                log("   本机节点 ID: $nodeId")

                // 2. 解析服务器节点 ID
                val remoteId = try {
                    EndpointId.fromString(serverNodeId)
                } catch(e: Exception) {
                    log("✗ 服务器节点 ID 格式错误: ${e.message}")
                    setState(State.STOPPED)
                    running.set(false)
                    return@launch
                }

                // 3. 启动本地 HTTP 代理（先监听，连接慢慢建 —— 连不上时 WebView 会拿到 502）
                val ss = ServerSocket(port, 64, java.net.InetAddress.getByName("127.0.0.1"))
                serverSocket = ss
                isReady = true
                log("② 本地代理已监听 http://127.0.0.1:$port（连接建立前访问会 502）")

                // 4. 连接到电脑端（无限重试：配对/网络恢复后自动连上）
                ensureConnection(remoteId)

                // 5. 启动连接监视器：断线自动重连
                startWatchdog(remoteId)

                // 6. accept 循环
                while (running.get()) {
                    val client = ss.accept()
                    scope.launch { handleClient(client) }
                }
            } catch(e: Exception) {
                if (running.get()) {
                    log("✗ 代理异常: ${e.javaClass.simpleName}: ${e.message}")
                    setState(State.STOPPED)
                    running.set(false)
                }
            }
        }
    }

    /** 停止并清理全部资源（幂等） */
    fun stop() {
        if (!running.getAndSet(false)) return
        isReady = false
        setState(State.STOPPED)
        scope.launch {
            watchdog?.cancel()
            watchdog = null
            try { serverSocket?.close() } catch(_: Exception) {}
            try { cachedConn?.close(0, byteArrayOf()) } catch(_: Exception) {}
            cachedConn = null
            try { endpoint?.shutdown() } catch(_: Exception) {}
            endpoint = null
            scope.cancel()
            android.util.Log.d(TAG, "代理已停止")
        }
    }

    // ---------- 连接管理 ----------

    /**
     * 建立到电脑端的 QUIC 连接，指数退避重试直到成功或代理停止。
     * 电脑端白名单是实时校验的：配对完成后下一次重试即连上，无需重启隧道。
     *
     * 退避：连续失败 5s→10s→20s→40s→60s（封顶），确认成功后归零。
     * 每次失败都记一行日志（重试间隔本身 ≥5s，不会刷屏），
     * 文案按异常类型区分：TimedOut=网络不通（非授权问题），
     * ApplicationClosed/秒断=到达了对端但被拒（才是配对问题）。
     *
     * ⚠ QUIC 握手成功 ≠ 授权通过：服务端在 accept 后（未配对）才关闭连接，
     * connect() 本身会成功返回。这里连接后等 2s 确认存活才算 READY，
     * 否则按失败处理走退避 —— 否则未配对场景每秒空转一次 connect。
     */
    private suspend fun ensureConnection(remoteId: EndpointId) {
        val ep = endpoint ?: return
        var attempt = 0
        while (running.get()) {
            attempt++
            try {
                setState(if (attempt == 1) State.CONNECTING else State.RECONNECTING)
                val t1 = System.currentTimeMillis()
                val conn = ep.connect(EndpointAddr(remoteId, null, emptyList()), ALPN)
                // 2s 存活确认：服务端「握手后即拒」在毫秒级发生
                delay(2000)
                // closed() 非挂起完成（连接已死）或抛异常都算被拒
                val dead = try {
                    withTimeoutOrNull(100) { conn.closed() } != null
                } catch(_: Exception) { true }
                if(dead) {
                    try { conn.close(0, byteArrayOf()) } catch(_: Exception) {}
                    throw Exception("连接被服务器立即关闭（未授权或服务器拒绝）")
                }
                cachedConn = conn
                connAttemptsSinceSuccess = 0
                refreshConnPath()
                setState(State.READY)
                log("③ 已连接服务器（${System.currentTimeMillis() - t1}ms${if (attempt > 1) "，第 $attempt 次尝试后成功" else ""}）→ 点「打开 MeNote」")
                return
            } catch(e: Exception) {
                connAttemptsSinceSuccess++
                val backoff = retryBackoffMs()
                val errDetail = when {
                    e.message?.contains("立即关闭", ignoreCase = true) == true -> "对端拒绝（未授权）—— 请到电脑端 admin「P2P 管理」授权"
                    e.message?.contains("timed out", ignoreCase = true) == true -> "连接超时（网络不通或对端离线）"
                    else -> "${e.javaClass.simpleName}: ${e.message ?: "未知错误"}"
                }
                log("② 连接失败（第 $attempt 次）: $errDetail")
                log("   ${backoff / 1000}s 后重试${if (connAttemptsSinceSuccess >= 4) "（已达上限间隔）" else "，间隔逐次递增"}")
                withContext(Dispatchers.IO) { delay(backoff) }
            }
        }
    }

    /** 连续失败计数（退避计算用） */
    @Volatile
    private var connAttemptsSinceSuccess = 0

    /** 5s→10s→20s→40s→60s 封顶 */
    private fun retryBackoffMs(): Long {
        val shift = connAttemptsSinceSuccess.coerceAtMost(4)   // 0..4
        return (RETRY_INTERVAL_MS shl shift).coerceAtMost(RETRY_BACKOFF_MAX_MS)
    }

    /**
     * 断线监视器：观察 QUIC 连接是否关闭（closed() 挂起直到连接结束），
     * 断开后自动进入重连循环。
     *
     * 注意：cachedConn 为 null（转发失败后清理）时【等待】而不是退出 ——
     * watchdog 是唯一的重连驱动者，退出后整个代理就失去自愈能力。
     */
    private fun startWatchdog(remoteId: EndpointId) {
        watchdog?.cancel()
        watchdog = scope.launch {
            var observed: Connection? = null
            while (running.get()) {
                val conn = cachedConn
                if (conn == null) {
                    // 连接被转发路径清掉：若刚观测过的那条已死，交回 ensureConnection 重建；
                    // 若正在重连（别的路径已在跑），等它完成
                    if (observed != null) {
                        log("⚠ 检测到连接失效，自动重连…")
                        observed = null
                        ensureConnection(remoteId)
                    } else {
                        delay(1000)  // 重连进行中，稍后再看
                    }
                    continue
                }
                try {
                    observed = conn
                    val connectedAt = System.currentTimeMillis()
                    // 挂起直到连接关闭（正常断开/网络切换/服务器重启）
                    conn.closed()
                    if (!running.get()) break
                    val aliveMs = System.currentTimeMillis() - connectedAt
                    if (aliveMs > 30_000) {
                        connAttemptsSinceSuccess = 0   // 存活过较久：正常断线，重置退避
                    } else {
                        connAttemptsSinceSuccess++    // 握手即断（未配对等）：计入退避
                    }
                    log("⚠ 与服务器的连接断开（存活 ${aliveMs / 1000}s）")
                    if (cachedConn === conn) { cachedConn = null; refreshConnPath() }
                    observed = null
                    // 退避等待放在 ensureConnection 内统一打印（避免两处日志重复/节奏不一致）
                } catch(e: Exception) {
                    if (!running.get()) break
                    log("⚠ 连接监视异常: ${e.message}")
                    if (cachedConn === conn) cachedConn = null
                    observed = null
                }
                ensureConnection(remoteId)
            }
        }
    }

    /**
     * 处理一条来自 WebView 的 HTTP 连接（keep-alive 下可能含多个请求）。
     * 解析→HttpExchange→QUIC 转发→HttpResponseData→写回，全走 ktor 数据结构。
     */
    private suspend fun handleClient(client: Socket) {
        try {
            // 60s > REQUEST_TIMEOUT + 重连等待，转发重试期间 WebView 连接不被掐死
            client.soTimeout = 60_000
            val input = client.getInputStream()
            val output = BufferedOutputStream(client.getOutputStream())

            while (running.get() && !client.isClosed) {
                val request = HttpCodec.parseRequest(input) ?: break  // 对端关闭
                val keepAlive = request.keepAlive

                val t0 = System.currentTimeMillis()
                val responseBytes = forwardOverQuic(HttpCodec.buildRequest(request))
                if (responseBytes == null) {
                    val err = HttpCodec.buildResponse(simpleResponse(HttpStatusCode.ServiceUnavailable, "P2P tunnel unavailable"))
                    output.write(err)
                    output.flush()
                    break
                }
                // 响应字节原样写回（服务端已是完整 HTTP/1.1 报文，Connection: close）
                output.write(responseBytes)
                output.flush()
                android.util.Log.d(TAG, "→ ${request.method.value} ${request.path} ${responseBytes.size}B ${System.currentTimeMillis() - t0}ms")

                if (!keepAlive) break
            }
        } catch(e: Exception) {
            android.util.Log.w(TAG, "client handler: ${e.message}")
        } finally {
            try { client.close() } catch(_: Exception) {}
        }
    }

    // ---------- HTTP 编解码（io.ktor.http 数据结构，见 HttpCodec） ----------

    // ---------- QUIC 转发 ----------

    /**
     * 把原始 HTTP/1.1 请求字节经 QUIC 双向流发给电脑端，收完整个响应。
     *
     * - 单次交换限时 REQUEST_TIMEOUT_MS：连接静默死亡（NAT 超时/切网，QUIC 层
     *   尚未感知）时 openBi/write 都会本地缓冲"成功"，但 readToEnd 永远等不到
     *   响应 —— 超时是唯一防线。
     * - 失败后自动重建连接并重试一次：用户侧表现为该请求慢了几秒后正常返回。
     * - 重连期间（cachedConn=null）最多等 RECONNECT_WAIT_MS，等不到给 WebView 502。
     */
    private suspend fun forwardOverQuic(requestRaw: ByteArray): ByteArray? {
        // 第一次尝试
        var result = exchangeOnce(requestRaw)
        if (result != null) return result

        // 失败：清理死连接，触发 watchdog/本地重建
        val deadConn = cachedConn
        if (deadConn != null) {
            try { deadConn.close(0, byteArrayOf()) } catch(_: Exception) {}
            if (cachedConn === deadConn) cachedConn = null
        }

        // 本地快速重建一次（不等 watchdog 轮询周期）——
        // 仅限连接曾经就绪过（运行期闪断自愈）；从未连上（未配对）时交给
        // ensureConnection 的退避循环，避免每个请求都触发一次 connect 轰炸
        val ep = endpoint
        if (ep != null && connAttemptsSinceSuccess < 2) {
            try {
                val remoteId = EndpointId.fromString(serverNodeId)
                val conn = ep.connect(EndpointAddr(remoteId, null, emptyList()), ALPN)
                cachedConn = conn
                log("⚠ 连接已重建（转发失败后自愈）")
            } catch(e: Exception) {
                android.util.Log.w(TAG, "转发后重建失败: ${e.message}")
                connAttemptsSinceSuccess++
            }
        }

        // 等连接可用后重试一次
        val retried = withTimeoutOrNull(RECONNECT_WAIT_MS) {
            while (cachedConn == null && running.get()) delay(300)
            if (cachedConn != null) exchangeOnce(requestRaw) else null
        }
        if (retried != null) {
            android.util.Log.i(TAG, "重试成功")
            return retried
        }

        // 彻底失败：通知 watchdog 进入重连循环
        log("✗ 转发失败（已重试），等待自动重连")
        return null
    }

    /** 单次 QUIC 交换：开流 → 写请求 → 收响应，限时 REQUEST_TIMEOUT_MS */
    private suspend fun exchangeOnce(requestRaw: ByteArray): ByteArray? {
        val conn = cachedConn ?: return null
        return try {
            withTimeoutOrNull(REQUEST_TIMEOUT_MS) {
                val stream = conn.openBi()
                val send: SendStream = stream.send()
                val recv: RecvStream = stream.recv()

                send.writeAll(requestRaw)
                send.finish()

                val response = recv.readToEnd(64u * 1024u * 1024u)
                send.close()
                recv.close()
                response
            }
        } catch(e: Exception) {
            android.util.Log.w(TAG, "QUIC 交换失败: ${e.message}")
            null
        }
    }

    // ---------- 身份密钥持久化 ----------

    /**
     * 载入或生成节点身份密钥（32 字节，存 keyStorePath）。
     * 持久化后节点 ID 固定 —— 电脑端 pair.js --add 一次即可。
     */
    private fun loadOrCreateNodeSecret(): ByteArray {
        val path = keyStorePath ?: return computer.iroh.SecretKey.generate().toBytes()
        return try {
            if (path.exists()) {
                val bytes = path.readBytes()
                if (bytes.size == 32) {
                    log("   身份密钥已加载（节点 ID 保持不变）")
                    bytes
                } else null
            } else null
        } catch(_: Exception) { null } ?: run {
            val sk = computer.iroh.SecretKey.generate()
            val bytes = sk.toBytes()
            try {
                path.parentFile?.mkdirs()
                path.writeBytes(bytes)
                log("   已生成新身份密钥并保存")
            } catch(e: Exception) {
                log("   ⚠ 密钥保存失败（每次启动节点 ID 会变）: ${e.message}")
            }
            bytes
        }
    }
}
