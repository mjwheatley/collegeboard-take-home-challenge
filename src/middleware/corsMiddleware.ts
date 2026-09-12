import httpCors from '@middy/http-cors';

import type { MiddlewareObj } from '@middy/core';

/**
 * CORS for the API's actual GET/POST/PUT responses (not the OPTIONS preflight, which
 * API Gateway handles itself). `@middy/http-cors` reflects only an origin that
 * matches the allowlist, so an arbitrary caller can't read a response cross-origin.
 *
 * No specific frontend origin is known yet for this project (no SPA consumer has been
 * built), so this defaults to `["*"]` (wildcard) rather than the fail-closed empty
 * array a real allowlist would use once a consumer origin is known. `credentials` is
 * `false` because the auth plan (see DECISIONS.md) is a bearer token, never cookies.
 */
const parseAllowedOrigins = (raw: string | undefined): string[] => {
  if (!raw) {
    return ['*'];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : ['*'];
  } catch {
    return ['*'];
  }
};

export const corsMiddleware = (allowedOriginsJson: string | undefined = process.env.ALLOWED_ORIGINS): MiddlewareObj =>
  httpCors({
    origins: parseAllowedOrigins(allowedOriginsJson),
    credentials: false,
  });
