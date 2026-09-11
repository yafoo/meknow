import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.menote.p2p"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.menote.p2p"
        minSdk = 29
        targetSdk = 35
        versionCode = 13
        versionName = "2.3"

        // 只打真机需要的 ABI：iroh 的 Rust QUIC 库单 ABI 就有 9~15MB，
        // 全 ABI 打包会让 APK 白背 3 份。需要模拟器调试时临时加回 x86_64。
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    // 签名配置：keystore 在工程根目录（已 gitignore），密码在 keystore.properties
    signingConfigs {
        create("release") {
            val ksFile = rootProject.file("keystore.properties")
            if (ksFile.exists()) {
                val ksProps = Properties().apply { ksFile.inputStream().use { load(it) } }
                storeFile = rootProject.file(ksProps.getProperty("storeFile"))
                storePassword = ksProps.getProperty("storePassword")
                keyAlias = ksProps.getProperty("keyAlias")
                keyPassword = ksProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // iroh JNA native 库含桌面平台 .so，打包时排除，只留 Android ABI
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
        resources {
            excludes += "/linux-aarch64/**"
            excludes += "/linux-x86-64/**"
            excludes += "/win32-x86-64/**"
            excludes += "/darwin-aarch64/**"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.material)
    implementation(libs.constraintlayout)

    // iroh P2P：AAR（含 Android .so + JNA AAR）
    implementation(libs.iroh)
    // iroh-desktop jar 里的 Kotlin 绑定类（computer.iroh 包），排除其桌面 JNA 依赖
    implementation(libs.iroh.jvm) {
        exclude(group = "net.java.dev.jna", module = "jna")
        exclude(group = "net.java.dev.jna", module = "jna-platform")
    }
    implementation(libs.jna) {
        artifact {
            type = "aar"
        }
    }

    // 二维码扫码：zxing 核心库（纯解析）+ CameraX 取流
    implementation(libs.zxing.core)
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)

    // Ktor 纯 HTTP 数据结构库：替代手写 HTTP/1.1 解析
    implementation(libs.ktor.http)
}
