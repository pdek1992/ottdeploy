# 📱 Android Build Workflow: "Vigil OTT"

This document outlines the optimized process for generating the Android APK and documents the resolutions for previous build failures.

## 🛠 Why the Build Was Failing (Post-Mortem)

Before the successful generation, the build environment encountered several critical blockers:

1.  **Java Heap Space (OutOfMemoryError)**:
    *   **Issue**: The default Gradle memory allocation was insufficient for the heavy dexing and merging required by Jetpack Compose and Media3 libraries.
    *   **Fix**: Added `org.gradle.jvmargs=-Xmx2048m` to `gradle.properties`.

2.  **Missing AndroidX Configuration**:
    *   **Issue**: Modern libraries require the AndroidX mapping. Without `android.useAndroidX=true`, the project failed to link various `.aar` dependencies.
    *   **Fix**: Created a proper `gradle.properties` in the root.

3.  **Resource Linker Conflicts (AAPT2)**:
    *   **Issue 1**: Missing app icons (`mipmap/ic_launcher`) in `AndroidManifest.xml`.
    *   **Issue 2**: Missing Material Components library dependency for the XML `Theme.Material3` style.
    *   **Fix**: Integrated `logo.png` as the primary drawable and added `com.google.android.material:material` to `build.gradle.kts`.

4.  **MinSDK Incompatibility**:
    *   **Issue**: Media3 and modern Compose components require at least API 26 (Android 8.0).
    *   **Fix**: Updated `minSdk = 26` in `app/build.gradle.kts`.

5.  **Font Resource Naming (AAPT2 Error)**:
    *   **Issue**: Android resource names cannot have capital letters or hyphens. Files like `Inter-Bold.ttf` cause immediate build failures.
    *   **Fix**: Renamed all font files to strictly lowercase with underscores (e.g., `inter_bold.ttf`).

6.  **Release APK Startup Crash (Font Loading)**:
    *   **Issue**: Release builds using R8 often strip font resources they mistakenly identify as "unused," causing `java.lang.IllegalStateException: Could not load font`.
    *   **Fix**: Disabled `isShrinkResources` in `build.gradle.kts` and added a `res/raw/keep.xml` file to protect the `@font/*` resources. Added `-keepclassmembers class **.R$font` to `proguard-rules.pro`.

7.  **Manual Font Resource Placement**:
    *   **Issue**: Sometimes automated scripts fail to fetch external font assets due to network restrictions.
    *   **Fix**: Manually place `inter_regular.ttf` and `inter_bold.ttf` in `AndroidApp\app\src\main\res\font\`. Ensure they are strictly lowercase.


---

## 🚀 How to Generate APK Faster (Optimized Steps)

Follow these steps to build the app without issues in the future:

### 1. Environment Prerequisite
Ensure your terminal is in the `AndroidApp` directory:
```powershell
cd "d:\Desktop Folders\Android app\OTT\AndroidApp"
```

### 2. Fast Incremental Build (Recommended)
If you only changed Kotlin code or layouts, run:
```powershell
./gradlew assembleDebug --parallel --build-cache
```
*   `--parallel`: Compiles modules in parallel.
*   `--build-cache`: Reuses results from previous builds.

### 3. Full Rebuild (If resources/configs changed)
If you added new icons or changed `AndroidManifest.xml`:
```powershell
./gradlew clean assembleDebug
```

### 4. Release Build (Production Ready)
To generate an optimized APK for distribution:
```powershell
./gradlew assembleRelease
```
*   **Location**: `D:\Desktop Folders\Android app\OTT\AndroidApp\app\build\outputs\apk\release\app-release-unsigned.apk`
*   **Important**: This APK is unsigned. For Play Store deployment, you must sign it using `apksigner`.

### 5. Locate your APK
After `BUILD SUCCESSFUL`, your APK is always here:
*   **Debug**: `app/build/outputs/apk/debug/app-debug.apk`
*   **Release**: `app/build/outputs/apk/release/app-release-unsigned.apk`

---

## 🔍 Common Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **"Expecting ')'" in Kotlin** | Check for unescaped double quotes in `Text("")` strings (common in `$query` interpolation). |
| **"Resource not found"** | Verify the file exists in `app/src/main/res/drawable` and is referenced correctly in XML. |
| **"Invalid character 'I'"** | Resource filenames must be lowercase. Rename `Inter.ttf` to `inter.ttf`. |
| **"Could not load font" (Release)** | Check if `isShrinkResources` is `true`. Set to `false` or update `res/raw/keep.xml`. |
| **"mergeExtDexDebug" failed** | This is usually a memory issue. Close other apps or increase `-Xmx` in `gradle.properties`. |

---

## 📡 Observability Verification
To ensure the app is sending metrics properly:
1.  Launch the app.
2.  Watch any video for >60 seconds.
3.  Check Grafana: Search for metrics starting with `qoe_` and filtered by `platform="android"`.
