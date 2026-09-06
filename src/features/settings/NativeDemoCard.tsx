import { useEffect, useState } from 'react';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { getBuildStamp, hello } from '../../../modules/hello-native';

export function NativeDemoCard() {
  const [stamp, setStamp] = useState('…');
  let greeting: string;
  try {
    greeting = hello('Maestro');
  } catch (e) {
    // `HelloNativeError` carries the "build a dev client" hint and a native bug
    // carries its own message; both are Errors, so the message is always the
    // more useful thing to show than a generic 'error' placeholder.
    greeting = e instanceof Error ? e.message : String(e);
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
