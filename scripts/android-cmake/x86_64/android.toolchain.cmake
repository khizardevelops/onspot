# CMake toolchain for whisper.cpp (src-tauri/plugins/speech) on Android x86_64.
# The NDK's toolchain needs ANDROID_ABI, which the `cmake` crate cannot pass
# through the environment, so this wraps it. Selected by scripts/android.sh.
# The file keeps the NDK's name: the `cmake` crate recognises an Android
# cross-build by it.
set(ANDROID_ABI x86_64)
set(ANDROID_PLATFORM android-24) # = minSdk in src-tauri/gen/android/app/build.gradle.kts
include("$ENV{NDK_HOME}/build/cmake/android.toolchain.cmake")
