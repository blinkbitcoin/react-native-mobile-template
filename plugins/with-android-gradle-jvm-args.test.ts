import type { ExpoConfig } from 'expo/config';
import withAndroidGradleJvmArgs from './with-android-gradle-jvm-args';

type Mods = { mods?: { android?: { gradleProperties?: (c: unknown) => Promise<unknown> } } };

type Prop = { type: string; key: string; value: string };

/** Returns a runner for the `gradleProperties` mod the plugin registered. */
const runner = (c: ExpoConfig & Mods) => {
  const mod = c.mods?.android?.gradleProperties;
  if (!mod) throw new Error('plugin did not register a gradleProperties mod');
  return async (props: Prop[]) =>
    (
      (await mod({ ...c, modResults: props, modRequest: {}, modRawConfig: c })) as {
        modResults: Prop[];
      }
    ).modResults;
};

test("replaces the template's jvmargs with larger heap and Metaspace caps, idempotently", async () => {
  const run = runner(
    withAndroidGradleJvmArgs({ name: 'x', slug: 'x' }, undefined) as ExpoConfig & Mods,
  );
  const once = await run([
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
  ]);
  expect(once).toEqual([
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m' },
  ]);
  expect(await run(once)).toEqual(once);
});

test('appends the property when gradle.properties does not declare it yet', async () => {
  const run = runner(
    withAndroidGradleJvmArgs({ name: 'x', slug: 'x' }, undefined) as ExpoConfig & Mods,
  );
  const out = await run([{ type: 'comment', key: 'x', value: 'y' }]);
  expect(out).toEqual([
    { type: 'comment', key: 'x', value: 'y' },
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m' },
  ]);
});

test('honours an explicit jvmArgs value', async () => {
  const run = runner(
    withAndroidGradleJvmArgs({ name: 'x', slug: 'x' }, { jvmArgs: '-Xmx8g' }) as ExpoConfig & Mods,
  );
  expect(await run([])).toEqual([{ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx8g' }]);
});
