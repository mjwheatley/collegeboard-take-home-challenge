/**
 * Zod validator middleware
 *
 * Validates a Middy handler's event/response against Zod schemas. `request.event` is
 * replaced with the parsed (and thus typed) value on success; a failing `.parse()`
 * throws a `ZodError`, which Middy propagates as the handler's error the same way any
 * other thrown error would be.
 *
 * The event here is the handler's already-normalized input payload (e.g. `{ id }` for
 * a get-by-id handler, or the create/update request body), not a raw API Gateway
 * event — mapping the real Lambda event into that shape is a concern for whatever sits
 * in front of this middleware in the chain, not this middleware itself.
 */

import type { MiddlewareObj, Request } from '@middy/core';
import type { ZodType } from 'zod';

export interface ZodValidatorMiddlewareOptions<TEvent, TResult> {
  requestSchema?: ZodType<TEvent>;
  responseSchema?: ZodType<TResult>;
}

export const zodValidatorMiddleware = <TEvent, TResult>({
  requestSchema,
  responseSchema,
}: ZodValidatorMiddlewareOptions<TEvent, TResult>): MiddlewareObj<TEvent, TResult> => ({
  before: (request: Request<TEvent, TResult>) => {
    if (requestSchema) {
      request.event = requestSchema.parse(request.event);
    }
  },
  after: (request: Request<TEvent, TResult>) => {
    if (responseSchema && request.response !== null && request.response !== undefined) {
      request.response = responseSchema.parse(request.response);
    }
  },
});
