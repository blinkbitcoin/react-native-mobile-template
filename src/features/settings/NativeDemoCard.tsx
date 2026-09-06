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
    getBuildStamp()
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
