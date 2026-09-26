import { act, render, screen } from '@testing-library/react-native';
import RootLayout from '@/app/_layout';
import { activateLocale } from '@/i18n/i18n';

// Jest's native stack draws no header, so the titles are read off the
// `Stack.Screen` elements themselves: each stand-in renders a host element
// that carries its route name and options.
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = ({ children }: { children: import('react').ReactNode }) =>
    createElement(View, { testID: 'stack' }, children);
  Stack.Screen = ({ name, options }: { name: string; options: object }) =>
    createElement('StackScreen', { testID: `screen:${name}`, options });
  return { ...jest.requireActual('expo-router'), Stack };
});

const optionsOf = (name: string) => screen.getByTestId(`screen:${name}`).props.options;

afterEach(async () => {
  await act(() => activateLocale('en'));
});

test('declares the tab group without its own header and the details screen', async () => {
  await render(<RootLayout />);

  expect(screen.getByTestId('stack')).toBeOnTheScreen();
  // The title doubles as the back label on pushed screens.
  expect(optionsOf('(tabs)')).toEqual({ headerShown: false, title: 'Home' });
  expect(optionsOf('details/[id]')).toEqual({ title: 'Details' });
});

test('the header titles follow a language change', async () => {
  await render(<RootLayout />);

  await act(() => activateLocale('es'));

  expect(optionsOf('(tabs)').title).toBe('Inicio');
  expect(optionsOf('details/[id]').title).toBe('Detalles');
});

describe('loading the module', () => {
  // Both are module-scope side effects, so each case loads the layout into a
  // fresh registry with the dependency replaced.
  test('installs the global error handler exactly once', () => {
    jest.isolateModules(() => {
      const installGlobalErrorHandler = jest.fn();
      jest.doMock('@/lib/global-error-handler', () => ({ installGlobalErrorHandler }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the layout has to load inside the isolated module registry
      require('@/app/_layout');
      expect(installGlobalErrorHandler).toHaveBeenCalledTimes(1);
    });
  });

  test('registers the sign-out on UNAUTHENTICATED, even before any screen uses auth', () => {
    jest.isolateModules(() => {
      const onUnauthenticated = jest.fn();
      jest.doMock('@/graphql/links/error', () => ({
        ...jest.requireActual('@/graphql/links/error'),
        onUnauthenticated,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the layout has to load inside the isolated module registry
      require('@/app/_layout');
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });
  });
});
