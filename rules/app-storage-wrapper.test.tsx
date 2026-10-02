import { storage } from '@/lib/storage';

// ruleid: rn-secret-in-storage-wrapper
void storage.set('session_token', token);

// ruleid: rn-secret-in-storage-wrapper
void storage.set(userPassword, token);

// ok: rn-secret-in-storage-wrapper
void storage.set('apollo-cache', snapshot);

// Another object with a set() of its own is not the wrapper.
const other = new Map();
// ok: rn-secret-in-storage-wrapper
other.set(authToken, token);
