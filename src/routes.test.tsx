import { render } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { View } from 'react-native';
import Html from '@/app/+html';

// Route files cannot hold a colocated test — expo-router's route context treats
// every `.ts(x)` under `src/app` as a route, and a stray `*.test.tsx` there would
// register as one — so the file-system router is exercised from here, against
// the real `src/app` tree rather than a hand-written route map.

test('the real route tree mounts the tab layout at the index route', async () => {
  await renderRouter('src/app', { initialUrl: '/' });

  expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-settings')).toBeOnTheScreen();
});

test('an unknown path renders the not-found route with a way home', async () => {
  await renderRouter('src/app', { initialUrl: '/no-such-route' });

  expect(screen.getByTestId('not-found-screen')).toBeOnTheScreen();
  expect(screen.getByText('Go home')).toBeOnTheScreen();
});

test('the web document shell wraps the app in a full HTML page', async () => {
  // `+html.tsx` is web-only and never reached by the native router, so it is
  // rendered directly; react-test-renderer treats `html`/`body` as host nodes.
  await render(
    <Html>
      <View testID="web-root" />
    </Html>,
  );

  expect(screen.getByTestId('web-root')).toBeOnTheScreen();
});
