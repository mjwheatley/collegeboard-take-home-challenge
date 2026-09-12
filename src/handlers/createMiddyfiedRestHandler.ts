import httpContentNegotiation from '@middy/http-content-negotiation';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import middyJsonBodyParser from '@middy/http-json-body-parser';
import httpResponseSerializer from '@middy/http-response-serializer';

import { RequestTimeoutError } from '../errors/RequestTimeoutError.js';
import { actorLogMetadataMiddleware } from '../middleware/actorLogMetadataMiddleware.js';
import { corsMiddleware } from '../middleware/corsMiddleware.js';
import { jsonErrorMessageMiddleware } from '../middleware/jsonErrorMessageMiddleware.js';
import { resetLoggerKeysMiddleware } from '../middleware/resetLoggerKeysMiddleware.js';
import { responseHeadersMiddleware } from '../middleware/responseHeadersMiddleware.js';
import { zodValidatorMiddleware } from '../middleware/zodValidatorMiddleware.js';

import {
  createMiddyfiedHandler,
  type CreateMiddyfiedHandlerOptions,
  type MiddyHandler,
} from './createMiddyfiedHandler.js';

import type { APIGatewayProxyEventV2JsonParsedBody } from '../types/api-gateway.js';
import type { MiddyfiedHandler } from '@middy/core';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ZodType } from 'zod';

/**
 * Deliberately loose (`ZodType<unknown>`, not `ZodType<TEvent>`/`ZodType<TResult>`
 * parameterized to match the handler's own hand-written event/result types): trying
 * to make the schema's inferred output type line up exactly with a hand-written
 * `WithPathParameters<...>`-style type is more type-system fighting than it's worth
 * here -- runtime validation is what actually enforces the shape; the hand-written
 * type is documentation for the handler body. This is also how the reference this is
 * ported from does it (their own `zodValidatorMiddleware` options aren't
 * generic-matched to a specific handler either).
 */
export interface CreateMiddyfiedRestHandlerOptions extends CreateMiddyfiedHandlerOptions {
  requestSchema?: ZodType<unknown>;
  responseSchema?: ZodType<unknown>;
}

/**
 * The full REST-handler middleware stack: everything `createMiddyfiedHandler` gives
 * every handler, plus the HTTP-specific pieces -- CORS, actor/logger metadata, response
 * headers, header normalization, JSON body parsing, error-to-JSON-response mapping,
 * content negotiation, response serialization, and (innermost, so it validates the
 * fully-parsed event/response) Zod validation.
 */
export const createMiddyfiedRestHandler = (
  handler: MiddyHandler,
  options?: CreateMiddyfiedRestHandlerOptions,
): MiddyfiedHandler<APIGatewayProxyEventV2JsonParsedBody, APIGatewayProxyStructuredResultV2> => {
  const newHandler = createMiddyfiedHandler<APIGatewayProxyEventV2JsonParsedBody, APIGatewayProxyStructuredResultV2>(
    handler,
    {
      ...options,
      plugin: {
        timeoutEarlyInMillis: 50,
        timeoutEarlyResponse() {
          throw new RequestTimeoutError('Request timed out');
        },
        ...options?.plugin,
      },
    },
  ).use([
    corsMiddleware(),
    resetLoggerKeysMiddleware(),
    actorLogMetadataMiddleware(),
    responseHeadersMiddleware({ Stage: process.env.ACCOUNT_STAGE }),
    httpHeaderNormalizer(),
    middyJsonBodyParser({ disableContentTypeError: true }),
    jsonErrorMessageMiddleware(),
    httpContentNegotiation(),
    httpResponseSerializer({
      serializers: [
        {
          regex: /^application\/json$/,
          serializer: ({ body }: { body?: unknown }) => (typeof body === 'string' ? body : JSON.stringify(body)),
        },
      ],
      defaultContentType: 'application/json',
    }),
    zodValidatorMiddleware({ requestSchema: options?.requestSchema, responseSchema: options?.responseSchema }),
  ]);

  return newHandler;
};
