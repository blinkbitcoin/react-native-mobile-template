import type { ConfigContext, ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT === 'production' ? 'production' : 'development';
const isDev = variant === 'development';
const iosBundleId = process.env.IOS_BUNDLE_ID ?? 'com.example.rnmt';
const androidPackage = process.env.ANDROID_PACKAGE ?? 'com.example.rnmt';
const otaEnabled = process.env.OTA_ENABLED === 'true';
const buildStamp = `${variant}-${process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}-${new Date().toISOString().slice(0, 10)}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? 'RN Mobile Template (dev)' : 'RN Mobile Template',
  slug: 'react-native-mobile-template',
  scheme: 'rnmt',
  version: process.env.APP_VERSION ?? '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // NOTE: SDK 57's `ExpoConfig` dropped the top-level `splash` field (splash screens
  // are now configured exclusively via the standalone `expo-splash-screen` plugin,
  // which is not installed in this task's scope). Left for a future task to wire up.
  ios: {
    bundleIdentifier: isDev ? `${iosBundleId}.dev` : iosBundleId,
    buildNumber: process.env.APP_BUILD_NUMBER ?? '1',
    supportsTablet: false,
  },
  android: {
    package: isDev ? `${androidPackage}.dev` : androidPackage,
    versionCode: Number(process.env.APP_BUILD_NUMBER ?? 1),
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#E6F4FE',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { bundler: 'metro', output: 'static', favicon: './assets/favicon.png' },
  runtimeVersion: { policy: 'fingerprint' },
  updates: otaEnabled
    ? {
        enabled: true,
        // exactOptionalPropertyTypes forbids an explicit `undefined` for an optional
        // string prop, so only include `url` when EXPO_UPDATES_URL is actually set.
        ...(process.env.EXPO_UPDATES_URL ? { url: process.env.EXPO_UPDATES_URL } : {}),
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
        requestHeaders: { 'expo-channel-name': 'production' },
      }
    : { enabled: false },
  experiments: { typedRoutes: true },
  extra: { variant, otaEnabled, buildStamp },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-sqlite',
    'expo-updates',
    ['./plugins/with-build-stamp', { stamp: buildStamp }],
    './plugins/with-android-release-signing',
    './plugins/with-android-release-abis',
  ],
});
