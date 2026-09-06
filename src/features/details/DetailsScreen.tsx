import { Trans } from '@lingui/react/macro';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export function DetailsScreen({ id }: { id: string }) {
  return (
    <Screen testID="details-screen">
      <AppText variant="title">
        <Trans>Details</Trans>
      </AppText>
      <AppText testID="details-id">{id}</AppText>
    </Screen>
  );
}
