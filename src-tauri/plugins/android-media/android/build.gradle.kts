plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.qurancaption.androidmedia"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.7.0")
    implementation("dev.ffmpegkit-maintained:ffmpeg-kit-full:8.1.7")
    implementation("com.arthenica:smart-exception-java:0.2.1")
    implementation(project(":tauri-android"))
}
