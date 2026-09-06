const store = new Map<string, string>();
const Storage = {
  async getItem(key: string) {
    return store.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    store.set(key, value);
  },
  async removeItem(key: string) {
    store.delete(key);
  },
  __reset() {
    store.clear();
  },
};
export default Storage;
