import { useQuery } from '@apollo/client/react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { router } from 'expo-router';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { HelloDocument } from '@/graphql/generated/graphql';
import { toUserMessage } from '@/lib/errors';

export function HomeScreen() {
  const { data, error } = useQuery(HelloDocument, { variables: { name: null } });

  return (
    <Screen testID="home-screen">
      <AppText variant="title" testID="home-title">
        <Trans>Home</Trans>
      </AppText>
      <AppText testID="home-hello">{error ? toUserMessage(error) : (data?.hello ?? '…')}</AppText>
      <Button
        title={t`Open details`}
        testID="home-open-details"
        onPress={() => router.push('/details/42')}
      />
    </Screen>
  );
}
