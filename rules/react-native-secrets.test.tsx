// ruleid: rn-secret-in-async-storage
AsyncStorage.setItem('auth_token', token);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem('last_screen', name);

// ruleid: rn-cleartext-fetch
const endpoint = 'http://api.example.com/graphql';

// ok: rn-cleartext-fetch
const local = 'http://localhost:8080/graphql';

// ok: rn-cleartext-fetch
const secure = 'https://api.example.com/graphql';

// ruleid: rn-webview-injected-javascript
const withToken = <WebView source={{ uri: url }} injectedJavaScript={`window.__TOKEN__ = "${authToken}";`} />;

// ok: rn-webview-injected-javascript
const staticOnly = <WebView source={{ uri: url }} injectedJavaScript={`window.__READY__ = true;`} />;
