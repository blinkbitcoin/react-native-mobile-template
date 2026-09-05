import { useLocalSearchParams } from 'expo-router';
import { DetailsScreen } from '@/features/details/DetailsScreen';

export default function DetailsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DetailsScreen id={id ?? ''} />;
}
