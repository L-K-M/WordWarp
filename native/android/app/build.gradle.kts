plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val appVersion = groovy.json.JsonSlurper().parse(rootProject.file("../../package.json")) as Map<*, *>

android {
    namespace = "app.wordwarp.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.wordwarp.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = appVersion["version"].toString()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir(rootProject.file("../../dist-native"))
    // Retain dependency notices, including identical filenames from different jars.
    // The generated asset inventory also preserves their original contents per artifact.
    packaging {
        resources.merges += setOf(
            "META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/LICENSE",
            "META-INF/LICENSE.txt", "META-INF/NOTICE", "META-INF/NOTICE.txt",
            "META-INF/DEPENDENCIES",
        )
    }
}

apply(from = rootProject.file("licenses.gradle"))

val verifyNativeAssets by tasks.registering {
    doLast {
        check(rootProject.file("../../dist-native/native.html").isFile) {
            "Build the shared renderer first: npm run build:native (from the repository root)."
        }
        check(rootProject.file("../../dist-native/licenses/index.html").isFile &&
            rootProject.file("../../dist-native/licenses/manifest.json").isFile &&
            rootProject.file("../../dist-native/fonts/SOURCES.json").isFile) {
            "The shared renderer is missing its reviewed license/font notices. Rebuild with npm run build:native before packaging Android."
        }
    }
}
tasks.named("preBuild").configure { dependsOn(verifyNativeAssets) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.12.00"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-savedstate:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.webkit:webkit:1.14.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.12.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 } }
