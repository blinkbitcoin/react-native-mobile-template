// ruleid: rn-secret-in-async-storage
AsyncStorage.setItem('auth_token', token);

// ok: rn-secret-in-async-storage
AsyncStorage.setItem('last_screen', name);

// ruleid: rn-cleartext-fetch
fetch('http://api.example.com/graphql');

// ruleid: rn-cleartext-fetch
const client = axios.create({ baseURL: 'http://api.example.com', timeout: 5000 });

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
