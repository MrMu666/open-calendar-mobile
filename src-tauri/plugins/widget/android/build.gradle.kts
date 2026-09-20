plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tauri.widget"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        // 小组件相关类由系统反射实例化/XML 引用，release 混淆时必须保留
        consumerProguardFiles("consumer-rules.pro")
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
    implementation(project(":tauri-android"))
    // tauri-android 用 implementation 引入 androidx，不会传递到本模块，必须自己声明：
    //  - appcompat：onDestroy(activity: AppCompatActivity) 的覆写签名需要它
    //  - core-ktx：本模块当前未直接使用（取色用 API 23+ 的 Context.getColor），
    //    保留以便后续使用 androidx 工具方法
    // 版本与 tauri-android 2.11.5 保持一致（1.6.0 / 1.7.0），避免依赖重复解析
    implementation("androidx.appcompat:appcompat:1.6.0")
    implementation("androidx.core:core-ktx:1.7.0")
}
