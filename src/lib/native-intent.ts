export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const legacy = /^\/d\/(\w+)$/.exec(path);
  return legacy ? `/details/${legacy[1]}` : path;
}
