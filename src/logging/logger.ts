import { Logger } from '@aws-lambda-powertools/logger';

import type { LogLevel } from '@aws-lambda-powertools/logger/types';

function isLogLevel(value: string | undefined): value is LogLevel {
  return !!value && ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL', 'SILENT'].includes(value.toUpperCase());
}

/**
 * Structured logging via AWS Lambda Powertools. `resetLoggerKeysMiddleware`/
 * `actorLogMetadataMiddleware` rely on this being a real Powertools `Logger`
 * instance (not just something duck-typed to look like one) since
 * `injectLambdaContext` and `.appendKeys()`/`.resetKeys()` are Powertools-specific.
 */
export const logger = new Logger({
  ...(isLogLevel(process.env.LOG_LEVEL) && { logLevel: process.env.LOG_LEVEL }),
});
