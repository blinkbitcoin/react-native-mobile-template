// ruleid: rn-secret-in-async-storage
AsyncStorage.setItem('auth_token', token);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem('last_screen', name);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem(keyExtractor, value);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem(keyboardHeight, value);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem(sortKey, value);

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
fetch('http://localhost:8080/graphql');

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
