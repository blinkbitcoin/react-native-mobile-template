import { Link } from 'expo-router';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export default function NotFound() {
  return (
    <Screen testID="not-found-screen">
      <AppText variant="title">Not found</AppText>
      <Link href="/">
        <AppText>Go home</AppText>
      </Link>
    </Screen>
  );
}
