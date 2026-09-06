import type { PropsWithChildren } from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createStyles } from '../theme/createStyles';

export function Screen({
  children,
  testID,
  scroll = false,
  ...rest
}: PropsWithChildren<{ testID: string; scroll?: boolean }> & ViewProps) {
  const styles = useStyles();
  // The scroll container itself fills the screen (`body`) while its content
  // only grows to fill it (`content` uses flexGrow, never flex): `flex: 1` on
  // the content container pins it to the viewport and kills scrolling.
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      {scroll ? (
        <ScrollView style={styles.body} contentContainerStyle={styles.content} {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, styles.content]} {...rest}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const useStyles = createStyles((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1 },
  content: { flexGrow: 1, padding: theme.spacing.md, gap: theme.spacing.sm },
}));
