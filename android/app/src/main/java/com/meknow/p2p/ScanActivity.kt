package com.meknow.p2p

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Size
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

/**
 * 扫码页：识别二维码内容（节点 ID），setResult 回传给 MainActivity。
 * zxing-core 纯解析 + CameraX ImageAnalysis 取 YUV 流，无第三方扫码 SDK 依赖。
 */
class ScanActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_RESULT = "scan_result"
        // 允许的节点 ID 长度（base32 52 / hex 64），用于过滤误扫
        private val ID_PATTERN = Regex("^[a-z2-7]{52}$|^[0-9a-f]{64}$", RegexOption.IGNORE_CASE)
    }

    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private var reader: MultiFormatReader? = null
    private var cameraProvider: ProcessCameraProvider? = null
    /** 已成功解码标志（防多帧重复触发 onDecoded） */
    @Volatile
    private var decodeHandled = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if(granted) {
                startCamera()
            } else {
                Toast.makeText(this, "需要相机权限才能扫码", Toast.LENGTH_SHORT).show()
                finish()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF101010.toInt())
        }
        previewView = PreviewView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        statusText = TextView(this).apply {
            text = "对准电脑端 admin 后台的节点 ID 二维码"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
            setPadding(32, 48, 32, 32)
            setBackgroundColor(0x66000000)
        }
        root.addView(previewView)
        root.addView(statusText, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 0 })
        setContentView(root)

        reader = MultiFormatReader().apply {
            setHints(mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true
            ))
        }

        if(ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                cameraProvider = provider

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val analysis = ImageAnalysis.Builder()
                    .setTargetResolution(Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(ContextCompat.getMainExecutor(this)) { image ->
                    val result = decodeQr(image)
                    image.close()
                    if(result != null) {
                        runOnUiThread { onDecoded(result) }
                    }
                }

                provider.unbindAll()
                provider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis
                )
                statusText.text = "对准电脑端 admin 后台的节点 ID 二维码"
            } catch(e: Exception) {
                Toast.makeText(this, "相机启动失败: ${e.message}", Toast.LENGTH_SHORT).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    /** YUV → zxing 解码；识别到可用内容返回文本，否则 null */
    private fun decodeQr(image: ImageProxy): String? {
        return try {
            reader ?: return null
            val plane = image.planes[0]      // Y 平面（亮度）足够二维码解码
            val buffer = plane.buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)

            // 行 stride 与像素 stride 的换算（部分设备 plane.rowStride > width）
            val width = image.width
            val height = image.height
            val data: ByteArray
            if(plane.rowStride == width) {
                data = bytes
            } else {
                data = ByteArray(width * height)
                var offset = 0
                for(row in 0 until height) {
                    System.arraycopy(bytes, row * plane.rowStride, data, offset, width)
                    offset += width
                }
            }

            val source = PlanarYUVLuminanceSource(
                data, width, height,
                0, 0, width, height,
                false
            )
            val bitmap = BinaryBitmap(HybridBinarizer(source))
            synchronized(reader!!) {
                val result = reader!!.decodeWithState(bitmap)
                result.text
            }
        } catch(_: Exception) {
            // 每帧多数都无码 —— 正常路径，不是错误
            try { reader?.reset() } catch(_: Exception) {}
            null
        } finally {
            try { reader?.reset() } catch(_: Exception) {}
        }
    }

    private fun onDecoded(text: String) {
        // 防重入：KEEP_ONLY_LATEST 下识别到 finish() 生效之间（约 2-3 帧）
        // 会多次命中本函数 —— 只处理第一次
        if(decodeHandled) return
        decodeHandled = true
        val trimmed = text.trim()
        // 原样回传（校验放 MainActivity —— 扫到的可能是 ID 也可能是以后别的格式）
        setResult(RESULT_OK, android.content.Intent().putExtra(EXTRA_RESULT, trimmed))
        Toast.makeText(this, "已识别", Toast.LENGTH_SHORT).show()
        finish()
    }

    override fun onDestroy() {
        try { cameraProvider?.unbindAll() } catch(_: Exception) {}
        super.onDestroy()
    }
}
