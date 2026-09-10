# iroh-ffi: uniffi 生成的绑定通过 JNA Native.register 反射加载
-keep class computer.iroh.** { *; }
-dontwarn computer.iroh.**

# JNA
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**

# Kotlin coroutines
-dontwarn kotlinx.coroutines.**
