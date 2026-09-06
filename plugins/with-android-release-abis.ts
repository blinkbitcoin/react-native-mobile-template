import { type ConfigPlugin, withGradleProperties } from 'expo/config-plugins';

/**
 * Restricts release builds to the ABIs real devices use, which roughly halves
 * the APK/AAB size. E2E debug builds on CI override this with
 * `-PreactNativeArchitectures=x86_64`, which wins over `gradle.properties`.
 */
const withAndroidReleaseAbis: ConfigPlugin<{ abis?: string[] } | undefined> = (config, props) => {
  const abis = props?.abis ?? ['armeabi-v7a', 'arm64-v8a'];
  return withGradleProperties(config, (c) => {
    const key = 'reactNativeArchitectures';
    const value = abis.join(',');
    const existing = c.modResults.find((p) => p.type === 'property' && p.key === key);
    if (existing && existing.type === 'property') existing.value = value;
    else c.modResults.push({ type: 'property', key, value });
    return c;
  });
};

export default withAndroidReleaseAbis;
