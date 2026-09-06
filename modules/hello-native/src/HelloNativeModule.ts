import { requireNativeModule } from 'expo';
import type { HelloNativeModuleType } from './HelloNative.types';

export default requireNativeModule<HelloNativeModuleType>('HelloNative');
