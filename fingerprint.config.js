// Fingerprint (runtimeVersion policy "fingerprint") inputs.
// ExpoConfigVersions: version/buildNumber/versionCode change every release but
// never change the native runtime, so they must not invalidate OTA updates.
const { SourceSkips } = require('@expo/fingerprint');

module.exports = { sourceSkips: SourceSkips.ExpoConfigVersions };
