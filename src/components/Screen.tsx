import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({
  children,
  testID,
  scroll = false,
}: PropsWithChildren<{ testID: string; scroll?: boolean }> & ViewProps) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <Body style={styles.body} contentContainerStyle={scroll ? styles.body : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, padding: 16, gap: 12 },
});
