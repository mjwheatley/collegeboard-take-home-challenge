import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy, { type MiddyfiedHandler } from '@middy/core';

import { logger } from '../logging/logger.js';
import { requestResponseLogger } from '../middleware/requestResponseLogger.js';

export type MiddyHandler = Parameters<MiddyfiedHandler['handler']>[0];

// PluginObject isn't exported by @middy/core itself; extract its shape structurally
// from middy()'s own second parameter instead of redeclaring it by hand.
export type MiddyPluginObject = NonNullable<Parameters<typeof middy>[1]>;

export interface CreateMiddyfiedHandlerOptions {
  plugin?: MiddyPluginObject;
}

const isProduction = process.env.ACCOUNT_STAGE === 'prd';

/**
 * The base middleware every Lambda handler gets, regardless of trigger type (HTTP,
 * DynamoDB Streams, etc.): structured logging with Lambda context injected, and
 * request/response/error logging. `featureFlagMiddleware` from the reference this is
 * ported from was deliberately dropped -- this project has no feature-flag service.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches MiddyfiedHandler's own default generics; a specific handler always narrows these.
export const createMiddyfiedHandler = <TEvent = any, TResult = any>(
  handler: MiddyHandler,
  options?: CreateMiddyfiedHandlerOptions,
): MiddyfiedHandler<TEvent, TResult> => {
  const newHandler = middy(handler, options?.plugin).use([
    injectLambdaContext(logger),
    requestResponseLogger<TEvent>({
      level: 'debug',
      logRequest: !isProduction,
      logResponse: !isProduction,
      logError: true,
    }),
  ]);

  return newHandler as MiddyfiedHandler<TEvent, TResult>;
};
