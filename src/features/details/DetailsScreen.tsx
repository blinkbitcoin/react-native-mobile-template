import { Trans } from '@lingui/react/macro';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';

export function DetailsScreen({ id }: { id: string }) {
  return (
    <Screen testID="details-screen">
      <AppText variant="title">
        <Trans>Details</Trans>
      </AppText>
      <Card>
        <AppText variant="caption">
          <Trans>Identifier</Trans>
        </AppText>
        <AppText testID="details-id">{id}</AppText>
      </Card>
    </Screen>
  );
}
