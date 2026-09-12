import { StatusCode } from '../util/http-status.js';

import { HttpError, type HttpErrorOptions } from './HttpError.js';

export class RequestTimeoutError extends HttpError {
  override name = 'RequestTimeoutError';

  constructor(message?: string, options?: HttpErrorOptions) {
    super(message, StatusCode.RequestTimeout, options);
  }
}
