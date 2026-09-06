import { Trans, useLingui } from '@lingui/react/macro';
import type { FallbackProps } from 'react-error-boundary';
import { toUserMessage } from '@/lib/errors';
import { AppText } from './AppText';
import { Button } from './Button';
import { Screen } from './Screen';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useLingui();
  return (
    <Screen testID="error-screen">
      <AppText variant="title" testID="error-title">
        <Trans>Something went wrong</Trans>
      </AppText>
      <AppText testID="error-message">{toUserMessage(error)}</AppText>
      <Button title={t`Try again`} testID="error-retry" onPress={resetErrorBoundary} />
    </Screen>
  );
}
