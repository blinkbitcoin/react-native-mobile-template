import type { ExpoConfig } from 'expo/config';
import withAndroidReleaseSigning from './with-android-release-signing';

type Mods = { mods?: { android?: { appBuildGradle?: (c: unknown) => Promise<unknown> } } };

const gradle = `android {\n  signingConfigs {\n    debug {\n      storeFile file('debug.keystore')\n    }\n  }\n  buildTypes {\n    release {\n      signingConfig signingConfigs.debug\n    }\n  }\n}\n`;

test('injects a release signingConfig fed by gradle properties, idempotently', async () => {
  const c = withAndroidReleaseSigning({ name: 'x', slug: 'x' }) as ExpoConfig & Mods;
  const mod = c.mods?.android?.appBuildGradle;
  if (!mod) throw new Error('plugin did not register an appBuildGradle mod');
  const run = async (contents: string) =>
    (
      (await mod({
        ...c,
        modResults: { contents, language: 'groovy', path: 'x' },
        modRequest: {},
        modRawConfig: c,
      })) as { modResults: { contents: string } }
    ).modResults.contents;
  const once = await run(gradle);
  expect(once).toContain("storeFile file(project.findProperty('ANDROID_UPLOAD_STORE_FILE')");
  expect(once).toContain('signingConfig signingConfigs.release');
  expect(once).not.toContain('signingConfig signingConfigs.debug\n    }\n  }\n}\n');
  const twice = await run(once);
  expect(twice).toBe(once);
});
