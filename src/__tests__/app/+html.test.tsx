import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import Html from '@/app/+html';

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
