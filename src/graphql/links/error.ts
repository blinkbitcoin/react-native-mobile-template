import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorLink } from '@apollo/client/link/error';
import { crashReporting } from '@/lib/crash-reporting';
import { logger } from '@/lib/logger';

const listeners = new Set<() => void>();

/** Subscribe to 401-equivalent GraphQL errors; returns an unsubscribe function. */
export function onUnauthenticated(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function createErrorLink() {
  return new ErrorLink(({ error, operation }) => {
    if (CombinedGraphQLErrors.is(error)) {
      if (error.errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) {
        for (const cb of listeners) cb();
      }
      logger.warn(`GraphQL error in ${operation.operationName}`, {
        messages: error.errors.map((e) => e.message),
      });
      return;
    }
    logger.error(`Network error in ${operation.operationName}`, { message: String(error) });
    crashReporting.captureException(error, { operation: operation.operationName });
  });
}
