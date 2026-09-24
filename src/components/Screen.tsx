import type { PropsWithChildren } from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createStyles } from '../theme/createStyles';

export function Screen({
  children,
  testID,
  scroll = false,
  style,
  ...rest
}: PropsWithChildren<{ testID: string; scroll?: boolean }> & ViewProps) {
  const styles = useStyles();
  // The scroll container itself fills the screen (`body`) while its content
  // only grows to fill it (`content` uses flexGrow, never flex): `flex: 1` on
  // the content container pins it to the viewport and kills scrolling.
  //
  // A caller's `style` is merged last so it can override the defaults; spread
  // through `...rest` it silently replaced them instead.
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      {scroll ? (
        <ScrollView style={[styles.body, style]} contentContainerStyle={styles.content} {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, styles.content, style]} {...rest}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const useStyles = createStyles((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1 },
  content: { flexGrow: 1, padding: theme.spacing.lg, gap: theme.spacing.md },
}));
