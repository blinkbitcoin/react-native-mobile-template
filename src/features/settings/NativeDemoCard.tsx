import { useEffect, useState } from 'react';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { getBuildStamp, HelloNativeError, hello } from '../../../modules/hello-native';

export function NativeDemoCard() {
  const [stamp, setStamp] = useState('…');
  let greeting: string;
  try {
    greeting = hello('Maestro');
  } catch (e) {
    greeting = e instanceof HelloNativeError ? e.message : 'error';
  }
  useEffect(() => {
    // `getBuildStamp` throws synchronously when the native module is missing
    // (web, Expo Go, Jest), so start the chain off a resolved promise and let
    // the single `catch` below handle both failure modes.
    Promise.resolve()
      .then(getBuildStamp)
      .then(setStamp)
      .catch(() => setStamp('unavailable'));
  }, []);
  return (
    <Card>
      <AppText testID="native-hello">{greeting}</AppText>
      <AppText testID="native-build-stamp">build-stamp:{stamp}</AppText>
    </Card>
  );
}
