import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { constants } from '@/config/constants';
import { activateLocale, type Locale } from '@/i18n/i18n';
import { updates, useUpdateInfo } from '@/services/updates';
import { createStyles } from '@/theme/createStyles';
import { useThemePreference } from '@/theme/useTheme';

/**
 * Build metadata and QA switches. Rendered only in the development variant or
 * after the hidden gesture on the Settings title — never in a production build
 * a real user installs.
 */
export function DevMenu() {
  const styles = useStyles();
  const { setPreference } = useThemePreference();
  const updateInfo = useUpdateInfo();
  // Lingui re-renders <Trans> on activate; this state keeps the plain `t`
  // strings below in sync too.
  const [, setLocale] = useState<Locale>('en');
  const [boom, setBoom] = useState(false);

  if (boom) throw new Error('Manual test error');

  function pickLocale(locale: Locale) {
    activateLocale(locale);
    setLocale(locale);
  }

  return (
    <View style={styles.container}>
      <AppText variant="caption" testID="settings-build-stamp">
        {constants.buildStamp}
      </AppText>
      <AppText variant="caption" testID="settings-version">
        {`${constants.version} (${constants.buildNumber})`}
      </AppText>

      <AppText variant="caption">
        <Trans>Theme</Trans>
      </AppText>
      <View style={styles.row}>
        <Button
          title={t`Light`}
          testID="settings-theme-light"
          onPress={() => setPreference('light')}
        />
        <Button
          title={t`Dark`}
          testID="settings-theme-dark"
          onPress={() => setPreference('dark')}
        />
        <Button
          title={t`System`}
          testID="settings-theme-system"
          onPress={() => setPreference('system')}
        />
      </View>

      <AppText variant="caption">
        <Trans>Language</Trans>
      </AppText>
      <View style={styles.row}>
        <Button title="English" testID="settings-lang-en" onPress={() => pickLocale('en')} />
        <Button title="Español" testID="settings-lang-es" onPress={() => pickLocale('es')} />
      </View>

      {constants.otaEnabled ? (
        <>
          <AppText variant="caption">
            <Trans>Channel</Trans>
          </AppText>
          <View style={styles.row}>
            <Button
              title="internal"
              testID="settings-channel-internal"
              onPress={() => void updates.switchChannel('internal')}
            />
            <Button
              title="beta"
              testID="settings-channel-beta"
              onPress={() => void updates.switchChannel('beta')}
            />
            <Button
              title="production"
              testID="settings-channel-production"
              onPress={() => void updates.switchChannel('production')}
            />
          </View>
          <AppText variant="caption" testID="settings-update-info">
            {JSON.stringify(updateInfo)}
          </AppText>
        </>
      ) : null}

      <Button
        title={t`Trigger error`}
        testID="settings-trigger-error"
        onPress={() => setBoom(true)}
      />
    </View>
  );
}

const useStyles = createStyles((theme) => ({
  container: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
}));
