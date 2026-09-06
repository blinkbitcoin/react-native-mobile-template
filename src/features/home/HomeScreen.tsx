import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { router } from 'expo-router';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';

export function HomeScreen() {
  return (
    <Screen testID="home-screen">
      <AppText variant="title" testID="home-title">
        <Trans>Home</Trans>
      </AppText>
      <Button
        title={t`Open details`}
        testID="home-open-details"
        onPress={() => router.push('/details/42')}
      />
    </Screen>
  );
}
