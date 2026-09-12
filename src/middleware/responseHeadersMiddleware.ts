import { normalizeHttpResponse } from '@middy/util';

import type { MiddlewareObj, Request as MiddyRequest } from '@middy/core';

export type HeaderBuilderValue = { toString(): string } | string | number | boolean;

export type HeaderBuilderFn = (request: MiddyRequest) => HeaderBuilderValue | undefined | Promise<HeaderBuilderValue | undefined>;

export type HeaderBuilders = Record<string, HeaderBuilderFn | HeaderBuilderValue | undefined>;

export interface ResponseHeadersOptions {
  overwrite?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Adds configurable, possibly-async response headers on both success and error responses. */
export const responseHeadersMiddleware = (
  headerBuilders: HeaderBuilders,
  options: ResponseHeadersOptions = {},
): MiddlewareObj => {
  const { overwrite = true } = options;

  const addResponseHeaders = async (request: MiddyRequest): Promise<void> => {
    const response: unknown = normalizeHttpResponse(request);
    const headers: Record<string, unknown> = {
      ...(isRecord(response) && isRecord(response.headers) ? response.headers : {}),
    };

    for (const [headerName, headerValue] of Object.entries(headerBuilders)) {
      if (headerValue === undefined) continue;

      if (headers[headerName] == null || overwrite) {
        const value =
          typeof headerValue === 'function' ? await (headerValue as HeaderBuilderFn)(request) : headerValue;

        if (value != null) {
          headers[headerName] = String(value);
        }
      }
    }

    request.response = { ...(isRecord(response) ? response : {}), headers };
  };

  return {
    after: (request) => addResponseHeaders(request),
    onError: async (request) => {
      if (request.response) {
        await addResponseHeaders(request);
      }
    },
  };
};
