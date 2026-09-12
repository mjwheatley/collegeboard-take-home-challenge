import { normalizeHttpResponse } from '@middy/util';
import { ZodError } from 'zod';

import { getErrorDetails, maybeRemoveStackProperty } from '../errors/error-details.js';
import { StatusCode } from '../util/http-status.js';

import type { APIGatewayProxyEventV2JsonParsedBody } from '../types/api-gateway.js';
import type { MiddlewareObj } from '@middy/core';

export interface JsonErrorMessageMiddlewareOptions {
  fallbackMessage?: string;
}

export interface ErrorResponseBody {
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  errors?: unknown;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Turns any thrown error into a JSON error response. `ZodError` (thrown by
 * `zodValidatorMiddleware`) always maps to 400 with a "Schema validation error"
 * message and the Zod issues attached -- everything else uses the error's own
 * `statusCode`/`expose` (see `HttpError`) if present, defaulting to 500 and hiding
 * the real message unless `ACCOUNT_STAGE` isn't `prd` (set by SST's function
 * defaults once task 7's `sst.config.ts` wires it up -- absent today, so this
 * defaults to exposing messages, which is the right default for local dev).
 */
export const jsonErrorMessageMiddleware = (
  options?: JsonErrorMessageMiddlewareOptions,
): MiddlewareObj<APIGatewayProxyEventV2JsonParsedBody> => ({
  onError(request) {
    if (!(request.error instanceof Error)) {
      return;
    }

    const isZodError = request.error instanceof ZodError;
    const {
      statusCode = StatusCode.InternalServerError,
      expose = process.env.ACCOUNT_STAGE !== 'prd',
      ...error
    } = maybeRemoveStackProperty(getErrorDetails(request.error));

    const message = isZodError
      ? 'Schema validation error'
      : expose
        ? error.message
        : options?.fallbackMessage ?? 'An error has occurred';

    const response: unknown = normalizeHttpResponse(request);
    const headers = isRecord(response) && isRecord(response.headers) ? response.headers : {};

    request.response = {
      ...(isRecord(response) ? response : {}),
      statusCode: isZodError ? StatusCode.BadRequest : statusCode,
      headers,
      body: JSON.stringify({
        message,
        cause: error.cause,
        details: error.details,
        ...(isZodError && { errors: (request.error as ZodError).issues }),
        requestId: request.event.requestContext.requestId,
      } satisfies ErrorResponseBody),
    };
  },
});
