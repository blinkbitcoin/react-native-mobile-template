// Expo Router hands `redirectSystemPath` the *incoming URL* for custom-scheme
// links (`rnmt://d/7`) and a plain path for in-app/HTTP navigation (`/d/7`), so
// the legacy pattern is anchored on a path segment boundary rather than on the
// start of the string.
const LEGACY_DETAILS = /(?:^|\/)d\/(\w+)$/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const legacy = LEGACY_DETAILS.exec(path);
  return legacy ? `/details/${legacy[1]}` : path;
}
