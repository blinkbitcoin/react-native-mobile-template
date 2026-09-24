import { render, screen } from '@testing-library/react-native';
import { useTheme as useNavigationTheme } from 'expo-router';
import { Text } from 'react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import { colorsByScheme, type Scheme } from '../theme/tokens';
import { NavigationTheme } from './NavigationTheme';

// The status bar is a native side effect with nothing to render in Jest, so it
// is replaced by a stand-in that exposes the one prop this component decides.
jest.mock('expo-status-bar', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    StatusBar: ({ style }: { style: string }) => <MockText testID="status-bar">{style}</MockText>,
  };
});

/** Reads the navigation theme the way a header or the tab bar does. */
function Probe() {
  const { dark, colors } = useNavigationTheme();
  return <Text testID="probe">{JSON.stringify({ dark, colors })}</Text>;
}

async function renderIn(scheme: Scheme) {
  await render(
    <ThemeProvider preference={scheme}>
      <NavigationTheme>
        <Probe />
      </NavigationTheme>
    </ThemeProvider>,
  );
  return JSON.parse(String(screen.getByTestId('probe').props.children));
}

test.each(['light', 'dark'] as const)(
  'the %s scheme reaches the navigator: monochrome, no library blue',
  async (scheme) => {
    const colors = colorsByScheme[scheme];
    const navigation = await renderIn(scheme);

    expect(navigation.dark).toBe(scheme === 'dark');
    expect(navigation.colors).toMatchObject({
      primary: colors.text,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      notification: colors.text,
    });
  },
);

test.each([
  ['light', 'dark'],
  ['dark', 'light'],
] as const)('the %s scheme gets %s status bar content', async (scheme, style) => {
  await renderIn(scheme);

  expect(screen.getByTestId('status-bar')).toHaveTextContent(style);
});
