import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { constants } from '@/config/constants';
import { activateLocale } from '@/i18n/i18n';
import { logger } from '@/lib/logger';
import { useAuth } from '@/services/auth';
import { type Channel, updates, useUpdateInfo } from '@/services/updates';
import { createStyles } from '@/theme/createStyles';
import { useThemePreference } from '@/theme/useTheme';

/** Dev-menu actions are fire-and-forget; a failure is logged, never thrown. */
function run(what: string, action: () => Promise<unknown>) {
  void action().catch((e: unknown) => logger.warn(`${what} failed`, { e: String(e) }));
}

function switchChannel(channel: Channel) {
  run(`switch to channel ${channel}`, () => updates.switchChannel(channel));
}

/**
 * Build metadata and QA switches. Rendered only in the development variant or
 * after the hidden gesture on the Settings title — never in a production build
 * a real user installs.
 */
export function DevMenu() {
  const styles = useStyles();
  const { setPreference } = useThemePreference();
  const updateInfo = useUpdateInfo();
  const { signedIn, signIn, signOut } = useAuth();
  // `useLingui` subscribes to locale activation, so the plain `t` strings below
  // re-render alongside <Trans>.
  const { t } = useLingui();
  const [boom, setBoom] = useState(false);

  if (boom) throw new Error('Manual test error');

  return (
    <View style={styles.container}>
      <AppText variant="caption" testID="settings-build-stamp">
        {constants.buildStamp}
      </AppText>
      <AppText variant="caption" testID="settings-version">
        {`${constants.version} (${constants.buildNumber})`}
      </AppText>

      <AppText variant="caption" style={styles.section}>
        <Trans>Theme</Trans>
      </AppText>
      <View style={styles.row}>
        <Button
          variant="secondary"
          title={t`Light`}
          testID="settings-theme-light"
          onPress={() => setPreference('light')}
        />
        <Button
          variant="secondary"
          title={t`Dark`}
          testID="settings-theme-dark"
          onPress={() => setPreference('dark')}
        />
        <Button
          variant="secondary"
          title={t`System`}
          testID="settings-theme-system"
          onPress={() => setPreference('system')}
        />
      </View>

      <AppText variant="caption" style={styles.section}>
        <Trans>Language</Trans>
      </AppText>
      <View style={styles.row}>
        <Button
          variant="secondary"
          title="English"
          testID="settings-lang-en"
          onPress={() => activateLocale('en')}
        />
        <Button
          variant="secondary"
          title="Español"
          testID="settings-lang-es"
          onPress={() => activateLocale('es')}
        />
      </View>

      {constants.otaEnabled ? (
        <>
          <AppText variant="caption" style={styles.section}>
            <Trans>Channel</Trans>
          </AppText>
          <View style={styles.row}>
            <Button
              variant="secondary"
              title="internal"
              testID="settings-channel-internal"
              onPress={() => switchChannel('internal')}
            />
            <Button
              variant="secondary"
              title="beta"
              testID="settings-channel-beta"
              onPress={() => switchChannel('beta')}
            />
            <Button
              variant="secondary"
              title="production"
              testID="settings-channel-production"
              onPress={() => switchChannel('production')}
            />
          </View>
          <AppText variant="caption" testID="settings-update-info">
            {JSON.stringify(updateInfo)}
          </AppText>
        </>
      ) : null}

      {/* Dev-only mock session controls, deliberately untranslated. */}
      <AppText variant="caption" testID="settings-auth-state">
        {signedIn ? 'signed in' : 'signed out'}
      </AppText>
      <View style={styles.row}>
        <Button
          variant="secondary"
          title="Sign in"
          testID="settings-auth-sign-in"
          onPress={() => run('sign-in', signIn)}
        />
        <Button
          variant="secondary"
          title="Sign out"
          testID="settings-auth-sign-out"
          onPress={() => run('sign-out', signOut)}
        />
      </View>

      <Button
        variant="secondary"
        title={t`Trigger error`}
        testID="settings-trigger-error"
        onPress={() => setBoom(true)}
      />
    </View>
  );
}

const useStyles = createStyles((theme) => ({
  container: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  // Section headings inside the menu: small caps-style labels above each row.
  section: {
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
}));
