# CMake toolchain for whisper.cpp (src-tauri/plugins/speech) on Android arm64-v8a.
# The NDK's toolchain needs ANDROID_ABI, which the `cmake` crate cannot pass
# through the environment, so this wraps it. Selected by scripts/android.sh.
# The file keeps the NDK's name: the `cmake` crate recognises an Android
# cross-build by it.
set(ANDROID_ABI arm64-v8a)
set(ANDROID_PLATFORM android-24) # = minSdk in src-tauri/gen/android/app/build.gradle.kts
include("$ENV{NDK_HOME}/build/cmake/android.toolchain.cmake")
