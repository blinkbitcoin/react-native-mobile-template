import Ionicons from '@expo/vector-icons/Ionicons';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet, View } from 'react-native';
import Html from '@/app/+html';

// Without a loaded font, vector icons render an empty string, so the tab icon
// test below could pass on any icon at all. A module mock, because
// `jest.spyOn` cannot redefine an ES module namespace export; the other tests
// here do not read glyphs, so reporting the font loaded changes nothing for them.
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), isLoaded: () => true }));

// Route files cannot hold a colocated test — expo-router's route context treats
// every `.ts(x)` under `src/app` as a route, and a stray `*.test.tsx` there would
// register as one — so the file-system router is exercised from here, against
// the real `src/app` tree rather than a hand-written route map.

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}

/** Depth-first walk of a `toJSON()` tree, root included. */
function* nodes(node: unknown): Generator<JsonNode> {
  if (node === null || typeof node !== 'object') return;
  const element = node as Partial<JsonNode>;
  if (typeof element.type === 'string') {
    yield { type: element.type, props: element.props ?? {}, children: element.children ?? [] };
  }
  for (const child of element.children ?? []) yield* nodes(child);
}

test('the real route tree mounts the tab layout at the index route', async () => {
  const router = renderRouter('src/app', { initialUrl: '/' });
  await router;

  expect(router.getPathname()).toBe('/');
  expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-home')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-settings')).toBeOnTheScreen();
});

test('every tab has an icon, filled on the active tab and outlined on the rest', async () => {
  const router = renderRouter('src/app', { initialUrl: '/' });
  await router;

  // The tab bar renders every icon twice, once `focused` and once not, and
  // cross-fades the two layers by opacity. The one a user sees is the layer at
  // opacity 1, so that is the one asserted.
  const glyphOf = (testID: string) => {
    const layers = screen.getAllByTestId(testID, { includeHiddenElements: true });
    const visible = layers.filter(
      (layer) => StyleSheet.flatten(layer.parent?.props.style)?.opacity === 1,
    );
    expect(visible).toHaveLength(1);
    return visible[0];
  };
  // Same resolution as the icon set itself: code points are numbers, a few are strings.
  const glyph = (name: keyof typeof Ionicons.glyphMap) => {
    const code = Ionicons.glyphMap[name];
    return typeof code === 'number' ? String.fromCodePoint(code) : code;
  };

  // React Navigation's `MissingIcon` placeholder is what a tab without
  // `tabBarIcon` draws; it must not appear anywhere in the bar.
  expect(screen.queryByText('⏷', { includeHiddenElements: true })).toBeNull();
  expect(glyphOf('tab-home-icon')).toHaveTextContent(glyph('home'));
  expect(glyphOf('tab-settings-icon')).toHaveTextContent(glyph('settings-outline'));

  await act(async () => {
    fireEvent.press(screen.getByTestId('tab-settings'));
  });

  expect(router.getPathname()).toBe('/settings');
  expect(glyphOf('tab-home-icon')).toHaveTextContent(glyph('home-outline'));
  expect(glyphOf('tab-settings-icon')).toHaveTextContent(glyph('settings'));
});

test('an unknown path renders the not-found route, whose link goes home', async () => {
  const router = renderRouter('src/app', { initialUrl: '/no-such-route' });
  await router;

  expect(screen.getByTestId('not-found-screen')).toBeOnTheScreen();
  // Pressing it, rather than only reading the label, is what pins the target:
  // the screen's whole job is to be a way back out of a bad URL.
  const home = screen.getByRole('link');
  expect(home.props.href).toBe('/');

  await act(async () => {
    fireEvent.press(home);
  });

  expect(router.getPathname()).toBe('/');
  expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
});

test('the web document shell emits a complete HTML page around the app', async () => {
  // `+html.tsx` is web-only and never reached by the native router, so it is
  // rendered directly; react-test-renderer treats `html`/`head`/`body` as host
  // nodes, which is what makes the document assertable at all.
  await render(
    <Html>
      <View testID="web-root" />
    </Html>,
  );

  const tree = [...nodes(screen.toJSON())];
  const typeOf = (type: string) => tree.filter((node) => node.type === type);
  const metaWith = (key: string, value: string) =>
    typeOf('meta').find((node) => node.props[key] === value);

  // The document element and its language: it decides hyphenation, a screen
  // reader's default voice, and what `:lang()` matches.
  expect(typeOf('html')[0]?.props.lang).toBe('en');

  // The three metas the shell exists to emit. Losing the viewport one is the
  // classic regression — the page then renders at desktop width on a phone.
  expect(metaWith('charSet', 'utf-8')).toBeDefined();
  expect(metaWith('httpEquiv', 'X-UA-Compatible')?.props.content).toBe('IE=edge');
  expect(metaWith('name', 'viewport')?.props.content).toBe(
    'width=device-width, initial-scale=1, shrink-to-fit=no',
  );

  // `<ScrollViewStyleReset />`, which keeps the body from scrolling behind the
  // app's own ScrollViews. It renders as a `<style id="expo-reset">`.
  expect(typeOf('style').some((node) => node.props.id === 'expo-reset')).toBe(true);

  // …and the app lands inside <body>, not beside it.
  const [body] = typeOf('body');
  expect(body).toBeDefined();
  expect([...nodes(body)].some((node) => node.props.testID === 'web-root')).toBe(true);
});
