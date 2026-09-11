package com.menote.p2p

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * WebView 页：加载本地代理 http://127.0.0.1:8080/admin/login
 * 所有请求（静态资源 / API）都经本地代理走 P2P 隧道，SPA 无任何改动。
 *
 * Cookie 持久化修复（2026-09-09）：
 *   1. CookieManager.flush() —— WebView 的 cookie 内存态不落盘，App 重启即丢。
 *      在页面导航/Activity 暂停时 flush 到磁盘（Chrome 持久化存储）。
 *   2. 进程级单例 —— CookieManager.getInstance() 本身是进程级的，
 *      但此前 WebActivity 每次都 new WebView + onDestroy 里 destroy，
 *      cookie 若未 flush 就丢。现在生命周期正确处理。
 *
 * 文件上传（2026-09-10）：编辑器里点「上传图片/文件」需要 WebView 的
 *   onShowFileChooser 弹系统文件选择器——默认 WebChromeClient 不实现它，
 *   症状是点了没反应。这里接 ActivityResultContracts + 回调桥。
 */
class WebActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    /** 文件选择回调桥：JS 的 <input type=file> 点击 → 系统选择器 → onActivityResult 转交 */
    private var filePathCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = mutableListOf<Uri>()
            result.data?.let { intent ->
                intent.data?.let { uris.add(it) }                       // 单选
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }  // 多选
            }
            filePathCallback?.onReceiveValue(
                if (uris.isEmpty()) null else uris.toTypedArray()
            )
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // 允许明文 http（本机回环代理）
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // SPA 状态
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + " MeNote/1.1"
        }

        // Cookie 持久化（admin 登录态）：进程级接受 + 本域 cookie
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // 只放行本地代理，其他一律拦截（保持隧道封闭）
                if (url.host == "127.0.0.1" || url.host == "localhost") {
                    return false
                }
                return true
            }

            // 每次页面导航后 flush：登录/登出设置 Set-Cookie 的时机
            override fun onPageFinished(view: WebView?, url: String?) {
                CookieManager.getInstance().flush()
            }
        }

        // WebChromeClient：文件选择器桥（编辑器上传图片/文件）
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: android.webkit.ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                // 上一次未完成的选择先取消（防泄漏回调）
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                try {
                    fileChooserLauncher.launch(params.createIntent())
                } catch(e: Exception) {
                    // 无文件管理器的极端 ROM
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = null
                    return false
                }
                return true
            }
        }

        webView.settings.mediaPlaybackRequiresUserGesture = false

        webView.loadUrl("http://127.0.0.1:8080/admin/login")
    }

    override fun onPause() {
        super.onPause()
        // 切后台时落盘：系统可能随时回收 Activity/进程
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        // 销毁前最后一搏：把 cookie 内存态写磁盘
        CookieManager.getInstance().flush()
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
