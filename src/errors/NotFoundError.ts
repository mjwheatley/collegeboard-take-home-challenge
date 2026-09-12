import { StatusCode } from '../util/http-status.js';

import { HttpError, type HttpErrorOptions } from './HttpError.js';

export class NotFoundError extends HttpError {
  override name = 'NotFoundError';

  constructor(message?: string, options?: HttpErrorOptions) {
    super(message, StatusCode.NotFound, { expose: true, ...options });
  }
}
