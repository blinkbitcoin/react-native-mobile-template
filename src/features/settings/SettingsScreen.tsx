import { Trans } from '@lingui/react/macro';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export function SettingsScreen() {
  return (
    <Screen testID="settings-screen" scroll>
      <AppText variant="title" testID="settings-title">
        <Trans>Settings</Trans>
      </AppText>
    </Screen>
  );
}
