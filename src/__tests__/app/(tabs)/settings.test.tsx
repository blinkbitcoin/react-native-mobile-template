import { renderRouter, screen } from 'expo-router/testing-library';
import SettingsRoute from '@/app/(tabs)/settings';
import { SettingsScreen } from '@/features/settings/SettingsScreen';

test('the settings route is the settings screen', () => {
  expect(SettingsRoute).toBe(SettingsScreen);
});

test('the real route tree mounts the settings screen at /settings', async () => {
  const router = renderRouter('src/app', { initialUrl: '/settings' });
  await router;

  expect(router.getPathname()).toBe('/settings');
  expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
});
