export default {
  hello: (name: string) => `Hello, ${name} from mock`,
  getBuildStamp: async () => 'mock-stamp',
  platformName: 'mock',
};
