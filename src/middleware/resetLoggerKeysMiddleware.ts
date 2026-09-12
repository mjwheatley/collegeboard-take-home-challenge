import { logger } from '../logging/logger.js';

import type { MiddlewareObj } from '@middy/core';

/** Clears any persistent logger keys (e.g. `actor`) left over from a previous invocation on a warm container. */
export const resetLoggerKeysMiddleware = (): MiddlewareObj => ({
  before: () => {
    logger.resetKeys();
  },
});
