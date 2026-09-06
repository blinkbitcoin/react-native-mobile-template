export type ErrorCode = 'NETWORK' | 'UNAUTHENTICATED' | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = code;
  }
}

const userMessages: Record<ErrorCode, string> = {
  NETWORK: 'Check your connection and try again.',
  UNAUTHENTICATED: 'Please sign in again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return userMessages[error.code];
  return userMessages.UNKNOWN;
}
