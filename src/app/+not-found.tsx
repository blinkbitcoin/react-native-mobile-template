import { Trans } from '@lingui/react/macro';
import { Link } from 'expo-router';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export default function NotFound() {
  return (
    <Screen testID="not-found-screen">
      <AppText variant="title">
        <Trans>Not found</Trans>
      </AppText>
      <Link href="/">
        <AppText>
          <Trans>Go home</Trans>
        </AppText>
      </Link>
    </Screen>
  );
}
