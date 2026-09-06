import { CodeGenerator, type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins';

const SIGNING = `    release {
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
    c.modResults.contents = contents;
    return c;
  });

export default withAndroidReleaseSigning;
