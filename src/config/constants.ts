import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  variant?: string;
  otaEnabled?: boolean;
  buildStamp?: string;
};

/** Build/runtime metadata for the app to display or report. */
export const constants = Object.freeze({
  version: Constants.expoConfig?.version ?? '0.0.0',
  buildNumber: String(
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '0',
  ),
  variant: extra.variant === 'production' ? 'production' : 'development',
  otaEnabled: extra.otaEnabled === true,
  buildStamp: extra.buildStamp ?? 'unknown',
});
