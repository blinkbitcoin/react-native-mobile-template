import Storage from 'expo-sqlite/kv-store';
import { storage } from '@/lib/storage';

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem('auth_token', token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(authToken, token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(apiKey, token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(accessKey, token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(sessionToken, token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(userPassword, token);

// ruleid: rn-secret-in-plain-storage
AsyncStorage.setItem(privateKey, token);

// ok: rn-secret-in-plain-storage
AsyncStorage.setItem('last_screen', name);

// ok: rn-secret-in-plain-storage
AsyncStorage.setItem(lastScreen, name);

// ok: rn-secret-in-plain-storage
AsyncStorage.setItem(keyExtractor, value);

// ok: rn-secret-in-plain-storage
AsyncStorage.setItem(keyboardHeight, value);

// ok: rn-secret-in-plain-storage
AsyncStorage.setItem(sortKey, value);

// The store this template actually uses, under any of its writers.
// ruleid: rn-secret-in-plain-storage
Storage.setItem('auth_token', token);

// ruleid: rn-secret-in-plain-storage
Storage.setItemSync(refreshToken, token);

// ruleid: rn-secret-in-plain-storage
void Storage.setItemAsync(apiKey, token);

// ok: rn-secret-in-plain-storage
Storage.setItem('last_screen', name);

// ok: rn-secret-in-plain-storage
Storage.getItem(authToken);

// The template's wrapper in front of kv-store, which is how app code writes.
// ruleid: rn-secret-in-plain-storage
void storage.set('session_token', token);

// ruleid: rn-secret-in-plain-storage
void storage.set(userPassword, token);

// ok: rn-secret-in-plain-storage
void storage.set('apollo-cache', snapshot);

// Another object with a set() of its own is not the wrapper.
const other = new Map();
// ok: rn-secret-in-plain-storage
other.set(authToken, token);

// ruleid: rn-cleartext-fetch
fetch('http://api.example.com/graphql');

// ruleid: rn-cleartext-fetch
const client = axios.create({ baseURL: 'http://api.example.com', timeout: 5000 });

// A constant reused at the call site, not an inline literal - the shape the
// over-broad round-1 regex caught and the narrowed AST-only patterns lost.
const BASE_URL = 'http://api.example.com/graphql';
// ruleid: rn-cleartext-fetch
fetch(BASE_URL);

// ok: rn-cleartext-fetch
fetch('http://localhost:1234/graphql');

// ok: rn-cleartext-fetch
fetch('https://api.example.com/graphql');

// ok: rn-cleartext-fetch
const icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" />;

// ruleid: rn-webview-injected-javascript
const withToken = <WebView source={{ uri: url }} injectedJavaScript={`window.__TOKEN__ = "${authToken}";`} />;

// ok: rn-webview-injected-javascript
const staticOnly = <WebView source={{ uri: url }} injectedJavaScript={`window.__READY__ = true;`} />;

// ruleid: rn-webview-injected-javascript
const beforeLoad = <WebView source={{ uri: url }} injectedJavaScriptBeforeContentLoaded={`window.__TOKEN__ = "${authToken}";`} />;
