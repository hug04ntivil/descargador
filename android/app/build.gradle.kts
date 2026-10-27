import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion = "1.0.0"
val appVersionCode = 1

// Credenciales de firma: android/keystore.properties (no se versiona). Ver GUIA-ANDROID.md.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "cl.hugo.descargador"
    compileSdk = 35

    defaultConfig {
        applicationId = "cl.hugo.descargador"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    // Un APK universal (funciona en cualquier teléfono) y uno por arquitectura (mucho más ligeros):
    // arm64-v8a = casi todos los teléfonos desde ~2017, armeabi-v7a = teléfonos de 32 bits, x86_64 = emuladores/Chromebooks.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    signingConfigs {
        if (keystoreProps.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // yt-dlp se ejecuta como proceso: las librerías nativas deben extraerse al instalar.
    // x86 de 32 bits (emuladores muy antiguos) se descarta para que el APK universal no engorde ~45 MB.
    packaging { jniLibs { useLegacyPackaging = true; excludes += "**/x86/*.so" } }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web"))
}

// La interfaz web es la misma del escritorio (../src/renderer); Android solo cambia platform.js.
val syncWeb = tasks.register<Sync>("syncWeb") {
    from(rootProject.file("../src/renderer")) { exclude("platform.js") }
    from("src/web")
    into(layout.buildDirectory.dir("generated/web/www"))
}
tasks.named("preBuild") { dependsOn(syncWeb) }

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
