// WEB ONLY
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';

export function NativeDemoCard() {
  return (
    <Card>
      <AppText testID="native-hello">Native demo unavailable on web</AppText>
    </Card>
  );
}
