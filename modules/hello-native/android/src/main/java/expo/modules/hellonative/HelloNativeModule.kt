package expo.modules.hellonative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HelloNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HelloNative")

    Constant("platformName") { "android" }

    Function("hello") { name: String ->
      "Hello, $name from Kotlin"
    }

    AsyncFunction("getBuildStamp") {
      val ctx = appContext.reactContext ?: return@AsyncFunction "missing"
      val info = ctx.packageManager.getApplicationInfo(ctx.packageName, android.content.pm.PackageManager.GET_META_DATA)
      info.metaData?.getString("AppBuildStamp") ?: "missing"
    }
  }
}
