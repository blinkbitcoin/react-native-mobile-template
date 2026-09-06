import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { constants } from '@/config/constants';
import { DevMenu } from './DevMenu';
import { NativeDemoCard } from './NativeDemoCard';

const TAPS_TO_REVEAL = 7;

export function SettingsScreen() {
  const { t } = useLingui();
  const [taps, setTaps] = useState(0);
  // Always on in development; in a release build the dev menu stays hidden
  // behind the classic seven-tap gesture on the title.
  const revealed = constants.variant === 'development' || taps >= TAPS_TO_REVEAL;

  return (
    <Screen testID="settings-screen" scroll>
      <AppText
        variant="title"
        testID="settings-title"
        accessibilityRole="button"
        accessibilityHint={t`Tap seven times to reveal the developer menu`}
        onPress={() => setTaps((n) => n + 1)}
      >
        <Trans>Settings</Trans>
      </AppText>
      <NativeDemoCard />
      {revealed ? <DevMenu /> : null}
    </Screen>
  );
}
