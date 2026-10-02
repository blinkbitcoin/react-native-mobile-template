import raw from '@blinkbitcoin/app-tooling/expo/jest/mocks/expo-sqlite-kv-store';
import { storage } from './storage';

test('round-trips JSON values and removes them', async () => {
  await storage.set('k', { n: 1 });
  expect(await storage.get<{ n: number }>('k')).toEqual({ n: 1 });
  await storage.remove('k');
  expect(await storage.get('k')).toBeNull();
});

test('returns null for corrupt JSON', async () => {
  await raw.setItem('bad', '{not json');
  expect(await storage.get('bad')).toBeNull();
});
