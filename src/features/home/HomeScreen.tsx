import { router } from 'expo-router';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';

export function HomeScreen() {
  return (
    <Screen testID="home-screen">
      <AppText variant="title" testID="home-title">
        Home
      </AppText>
      <Button
        title="Open details"
        testID="home-open-details"
        onPress={() => router.push('/details/42')}
      />
    </Screen>
  );
}
