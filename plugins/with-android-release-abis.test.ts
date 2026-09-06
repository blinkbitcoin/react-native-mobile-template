import type { ExpoConfig } from 'expo/config';
import withAndroidReleaseAbis from './with-android-release-abis';

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

test('sets reactNativeArchitectures to arm ABIs by default, idempotently', async () => {
  const run = runner(
    withAndroidReleaseAbis({ name: 'x', slug: 'x' }, undefined) as ExpoConfig & Mods,
  );
  const once = await run([
    {
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'armeabi-v7a,arm64-v8a,x86,x86_64',
    },
  ]);
  expect(once).toEqual([
    { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a' },
  ]);
  expect(await run(once)).toEqual(once);
});

test('appends the property when gradle.properties does not declare it yet', async () => {
  const run = runner(
    withAndroidReleaseAbis({ name: 'x', slug: 'x' }, undefined) as ExpoConfig & Mods,
  );
  const out = await run([{ type: 'comment', key: 'x', value: 'y' }]);
  expect(out).toEqual([
    { type: 'comment', key: 'x', value: 'y' },
    { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a' },
  ]);
});

test('honours an explicit abis list', async () => {
  const run = runner(
    withAndroidReleaseAbis({ name: 'x', slug: 'x' }, { abis: ['x86_64'] }) as ExpoConfig & Mods,
  );
  expect(await run([])).toEqual([
    { type: 'property', key: 'reactNativeArchitectures', value: 'x86_64' },
  ]);
});
