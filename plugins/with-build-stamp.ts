import {
  AndroidConfig,
  type ConfigPlugin,
  withAndroidManifest,
  withInfoPlist,
} from 'expo/config-plugins';

/**
 * Writes the build stamp into both native projects so the app can read it back
 * at runtime (`modules/hello-native` reads `AppBuildStamp` from Info.plist on
 * iOS and from the manifest `<meta-data>` on Android).
 */
const withBuildStamp: ConfigPlugin<{ stamp: string }> = (config, { stamp }) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.AppBuildStamp = stamp;
    // Only default it: an explicit value (e.g. an app that does use non-exempt
    // encryption) must survive prebuild.
    if (c.modResults.ITSAppUsesNonExemptEncryption === undefined) {
      c.modResults.ITSAppUsesNonExemptEncryption = false;
    }
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    // Replaces an existing item of the same name, which makes this idempotent.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'AppBuildStamp', stamp);
    return c;
  });
  return config;
};

export default withBuildStamp;
