import { type ConfigPlugin, withGradleProperties } from 'expo/config-plugins';

/**
 * Gives the Gradle daemon enough JVM to finish a release build.
 *
 * Expo's bare template writes `-Xmx2048m -XX:MaxMetaspaceSize=512m`. A debug
 * build fits; a release build does not, because `lintVitalAnalyzeRelease`
 * loads every module's lint model into the same daemon and Metaspace is what
 * runs out. On 2026-09-18 the first internal release did exactly that on a
 * 16 GB runner: the daemon logged "running out of JVM Metaspace" at minute
 * seven, the lint task failed, the daemon hung instead of exiting, and the
 * job burned its whole 60-minute bound. Doubling both caps is the fix the
 * React Native issue tracker has converged on for that task.
 */
const withAndroidGradleJvmArgs: ConfigPlugin<{ jvmArgs?: string } | undefined> = (
  config,
  props,
) => {
  const value = props?.jvmArgs ?? '-Xmx4096m -XX:MaxMetaspaceSize=1024m';
  return withGradleProperties(config, (c) => {
    const key = 'org.gradle.jvmargs';
    const existing = c.modResults.find((p) => p.type === 'property' && p.key === key);
    if (existing && existing.type === 'property') existing.value = value;
    else c.modResults.push({ type: 'property', key, value });
    return c;
  });
};

export default withAndroidGradleJvmArgs;
