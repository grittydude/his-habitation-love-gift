export type ApiErrorKind = 'network' | 'server';

/**
 * `network`: the request may not have reached the server (offline, timeout).
 * The outcome of a draw is therefore unknown — never report success.
 * `server`: the server answered with an error or an unexpected payload.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'network';
}
