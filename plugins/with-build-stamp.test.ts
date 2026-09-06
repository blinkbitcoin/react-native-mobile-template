import type { ExpoConfig } from 'expo/config';
import withBuildStamp from './with-build-stamp';

type Mod = (c: unknown) => Promise<unknown>;
type Mods = {
  mods?: { ios?: { infoPlist?: Mod }; android?: { manifest?: Mod } };
};

const base = (): ExpoConfig => ({ name: 'x', slug: 'x' });

const modOf = (mod: Mod | undefined, name: string): Mod => {
  if (!mod) throw new Error(`plugin did not register a ${name} mod`);
  return mod;
};

async function runIos(config: ExpoConfig & Mods, plist: Record<string, unknown>) {
  const mod = modOf(config.mods?.ios?.infoPlist, 'infoPlist');
  const r = (await mod({
    ...config,
    modResults: plist,
    modRequest: {},
    modRawConfig: config,
  })) as { modResults: Record<string, unknown> };
  return r.modResults;
}

test('sets AppBuildStamp and the encryption key on iOS, without clobbering an existing encryption value', async () => {
  const c = withBuildStamp(base(), { stamp: 's1' }) as ExpoConfig & Mods;
  const out = await runIos(c, { ITSAppUsesNonExemptEncryption: true });
  expect(out.AppBuildStamp).toBe('s1');
  expect(out.ITSAppUsesNonExemptEncryption).toBe(true);
  const fresh = await runIos(withBuildStamp(base(), { stamp: 's2' }) as ExpoConfig & Mods, {});
  expect(fresh.ITSAppUsesNonExemptEncryption).toBe(false);
});

test('adds one AppBuildStamp meta-data entry to the Android manifest, idempotently', async () => {
  const c = withBuildStamp(base(), { stamp: 's1' }) as ExpoConfig & Mods;
  const mod = modOf(c.mods?.android?.manifest, 'manifest');
  const manifest = {
    manifest: {
      application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [] as unknown[] }],
    },
  };
  const run = async () =>
    (
      (await mod({ ...c, modResults: manifest, modRequest: {}, modRawConfig: c })) as {
        modResults: typeof manifest;
      }
    ).modResults;
  const once = await run();
  const twice = await run();
  const meta = twice.manifest.application[0]?.['meta-data'] as { $: Record<string, string> }[];
  expect(meta.filter((m) => m.$['android:name'] === 'AppBuildStamp')).toHaveLength(1);
  expect(meta[0]?.$['android:value']).toBe('s1');
  expect(once).toBe(twice);
});
