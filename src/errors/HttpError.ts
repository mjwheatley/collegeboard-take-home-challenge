export interface HttpErrorOptions extends ErrorOptions {
  /** Whether this error's message is safe to return to the client (vs. a generic fallback). */
  expose?: boolean;
  details?: Record<string, unknown>;
}

export class HttpError extends Error {
  override name = 'HttpError';
  statusCode: number;
  expose?: boolean;
  details?: Record<string, unknown>;

  constructor(message: string | undefined, statusCode: number, options?: HttpErrorOptions) {
    super(message, options);

    this.statusCode = statusCode;
    this.expose = options?.expose;
    this.details = options?.details;
  }
}
