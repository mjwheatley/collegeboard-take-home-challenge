import { logger } from '../logging/logger.js';

import type { MiddlewareObj } from '@middy/core';

export interface RequestResponseLoggerOptions {
  level?: 'info' | 'debug';
  logRequest?: boolean;
  logResponse?: boolean;
  logError?: boolean;
}

export const requestResponseLogger = <TEvent>(options: RequestResponseLoggerOptions = {}): MiddlewareObj<TEvent> => {
  const { level = 'info', logRequest = true, logResponse = true, logError = true } = options;

  const middleware: MiddlewareObj<TEvent> = {
    ...(logRequest && {
      before: (request) => {
        logger[level]('Request', { event: request.event });
      },
    }),
    ...(logResponse && {
      after: (request) => {
        if (typeof request.response !== 'undefined') {
          logger[level]('Response', { response: request.response });
        }
      },
    }),
    ...(logError && {
      onError: (request) => {
        logger.error('Error', { error: request.error, response: request.response });
      },
    }),
  };

  // Middy requires at least one of before/after/onError to be present.
  if (!middleware.before && !middleware.after && !middleware.onError) {
    return { before: () => undefined };
  }

  return middleware;
};
