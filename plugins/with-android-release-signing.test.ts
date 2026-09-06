import type { ExpoConfig } from 'expo/config';
import withAndroidReleaseSigning from './with-android-release-signing';

type Mods = { mods?: { android?: { appBuildGradle?: (c: unknown) => Promise<unknown> } } };

const gradle = `android {\n  signingConfigs {\n    debug {\n      storeFile file('debug.keystore')\n    }\n  }\n  buildTypes {\n    release {\n      signingConfig signingConfigs.debug\n    }\n  }\n}\n`;

function runner() {
  const c = withAndroidReleaseSigning({ name: 'x', slug: 'x' }) as ExpoConfig & Mods;
  const mod = c.mods?.android?.appBuildGradle;
  if (!mod) throw new Error('plugin did not register an appBuildGradle mod');
  return async (contents: string) =>
    (
      (await mod({
        ...c,
        modResults: { contents, language: 'groovy', path: 'x' },
        modRequest: {},
        modRawConfig: c,
      })) as { modResults: { contents: string } }
    ).modResults.contents;
}

test('injects a release signingConfig fed by gradle properties, idempotently', async () => {
  const run = runner();
  const once = await run(gradle);
  expect(once).toContain("storeFile file(project.findProperty('ANDROID_UPLOAD_STORE_FILE')");
  expect(once).toContain('signingConfig signingConfigs.release');
  expect(once).not.toContain('signingConfig signingConfigs.debug\n    }\n  }\n}\n');
  const twice = await run(once);
  expect(twice).toBe(once);
});

test('warns at configuration time when the upload keystore properties are missing', async () => {
  const once = await runner()(gradle);
  expect(once).toContain("if (!project.hasProperty('ANDROID_UPLOAD_STORE_FILE'))");
  expect(once).toContain(
    'ANDROID_UPLOAD_* gradle properties not set: release build will be signed with the DEBUG keystore',
  );
});

test('fails loudly when the release buildType signingConfig cannot be rewritten', async () => {
  // A template whose release buildType does not point at signingConfigs.debug:
  // silently leaving it alone would ship a debug-signed release build.
  const unknown = `android {\n  signingConfigs {\n    debug {\n    }\n  }\n  buildTypes {\n    release {\n      minifyEnabled true\n    }\n  }\n}\n`;
  await expect(runner()(unknown)).rejects.toThrow(
    'with-android-release-signing: could not find the release buildType signingConfig to rewrite',
  );
});
