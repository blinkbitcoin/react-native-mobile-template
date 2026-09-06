export type HelloNativeModuleType = {
  hello(name: string): string;
  getBuildStamp(): Promise<string>;
  platformName: string;
};
