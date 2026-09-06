import { CodeGenerator, type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins';

const SIGNING = `    release {
      if (!project.hasProperty('ANDROID_UPLOAD_STORE_FILE')) {
        project.logger.warn('[rnmt] ANDROID_UPLOAD_* gradle properties not set: release build will be signed with the DEBUG keystore')
      }
      storeFile file(project.findProperty('ANDROID_UPLOAD_STORE_FILE') ?: 'debug.keystore')
      storePassword project.findProperty('ANDROID_UPLOAD_STORE_PASSWORD') ?: 'android'
      keyAlias project.findProperty('ANDROID_UPLOAD_KEY_ALIAS') ?: 'androiddebugkey'
      keyPassword project.findProperty('ANDROID_UPLOAD_KEY_PASSWORD') ?: 'android'
    }`;

/**
 * Adds a `release` signingConfig fed by gradle properties and points the
 * release build type at it. Credentials come from `gradle.properties`/`-P`
 * flags set by CI from secrets; the debug fallbacks keep a local
 * `expo run:android --variant release` working without any secrets.
 */
const withAndroidReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (c) => {
    let contents = c.modResults.contents;
    // `mergeContents` is idempotent: it recognises its own tagged block.
    contents = CodeGenerator.mergeContents({
      src: contents,
      newSrc: SIGNING,
      tag: 'rnmt-release-signing',
      anchor: /signingConfigs\s*\{/,
      offset: 1,
      comment: '//',
    }).contents;
    contents = contents.replace(
      /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );
    // A silent no-op here would ship a release APK signed with the debug
    // keystore, so an unrecognised template must fail the prebuild loudly.
    if (!contents.includes('signingConfig signingConfigs.release'))
      throw new Error(
        'with-android-release-signing: could not find the release buildType signingConfig to rewrite',
      );
    c.modResults.contents = contents;
    return c;
  });

export default withAndroidReleaseSigning;
