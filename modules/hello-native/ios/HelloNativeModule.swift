import ExpoModulesCore

public class HelloNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HelloNative")

    Constant("platformName") { "ios" }

    Function("hello") { (name: String) -> String in
      return "Hello, \(name) from Swift"
    }

    AsyncFunction("getBuildStamp") { () -> String in
      return Bundle.main.object(forInfoDictionaryKey: "AppBuildStamp") as? String ?? "missing"
    }
  }
}
