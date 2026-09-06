// The only file allowed to use console.* (Biome override). Swap the sink here
// when adding a crash reporter or remote logging.
type Meta = Record<string, unknown>;

function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Meta) {
  if (level === 'debug' && !__DEV__) return;
  const line = `[${level}] ${message}`;
  if (meta === undefined) console[level](line);
  else console[level](line, meta);
}

export const logger = {
  debug: (m: string, meta?: Meta) => emit('debug', m, meta),
  info: (m: string, meta?: Meta) => emit('info', m, meta),
  warn: (m: string, meta?: Meta) => emit('warn', m, meta),
  error: (m: string, meta?: Meta) => emit('error', m, meta),
};
