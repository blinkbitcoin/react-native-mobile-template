import type { PropsWithChildren } from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createStyles } from '../theme/createStyles';

export function Screen({
  children,
  testID,
  scroll = false,
}: PropsWithChildren<{ testID: string; scroll?: boolean }> & ViewProps) {
  const styles = useStyles();
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <Body style={styles.body} contentContainerStyle={scroll ? styles.body : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

const useStyles = createStyles((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1, padding: theme.spacing.md, gap: theme.spacing.sm },
}));
