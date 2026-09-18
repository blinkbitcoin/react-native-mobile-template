import type { ConfigContext, ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT === 'production' ? 'production' : 'development';
const isDev = variant === 'development';
// `||`, not `??`, and that is the whole point: a workflow input left unset
// arrives as an empty string, not as an absent variable, and `??` only falls
// back on null/undefined. `IOS_BUNDLE_ID: ''` therefore passed straight through
// as the bundle identifier, Expo saw no identifier at all, and `expo prebuild`
// died with "Cannot automatically write to dynamic config" while trying to
// persist com.anonymous.<slug>. Empty is falsy but not nullish - the same trap
// as the `&&`/`||` expression pitfall documented in the release workflows.
const iosBundleId = process.env.IOS_BUNDLE_ID || 'com.example.rnmt';
const androidPackage = process.env.ANDROID_PACKAGE || 'com.example.rnmt';
const otaEnabled = process.env.OTA_ENABLED === 'true';
const buildStamp = `${variant}-${process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}-${new Date().toISOString().slice(0, 10)}`;
const webDomain = process.env.EXPO_PUBLIC_WEB_DOMAIN;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? 'RN Mobile Template (dev)' : 'RN Mobile Template',
  slug: 'react-native-mobile-template',
  scheme: 'rnmt',
  version: process.env.APP_VERSION || '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: isDev ? `${iosBundleId}.dev` : iosBundleId,
    buildNumber: process.env.APP_BUILD_NUMBER || '1',
    supportsTablet: false,
    associatedDomains: webDomain ? [`applinks:${webDomain}`] : [],
  },
  android: {
    package: isDev ? `${androidPackage}.dev` : androidPackage,
    versionCode: Number(process.env.APP_BUILD_NUMBER || 1),
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#E6F4FE',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: webDomain
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: webDomain, pathPrefix: '/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : [],
  },
  // init:web-start
  web: { bundler: 'metro', output: 'static', favicon: './assets/favicon.png' },
  // init:web-end
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
        // Public certificate; the private key lives in the release secret
        // store and signs manifests at publish time. See certs/README.md.
        codeSigningCertificate: './certs/expo-updates-cert.pem',
        codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
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
    './plugins/with-android-gradle-jvm-args',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: { backgroundColor: '#0b0b0f' },
      },
    ],
    ['expo-font', { fonts: ['./assets/fonts/Inter-Variable.ttf'] }],
  ],
});
