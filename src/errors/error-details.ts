/**
 * `JSON.stringify(error)` doesn't include an Error's own properties (message, stack,
 * custom fields like `statusCode`/`expose`/`details` on `HttpError`) — these helpers
 * pull them into a plain object so `jsonErrorMessageMiddleware` can serialize them.
 */

export interface ErrorDetails {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  expose?: boolean;
  statusCode?: number;
  details?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getErrorDetails(error: Error): ErrorDetails {
  const ownProperties = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = Reflect.get(error, key);

    return acc;
  }, {});

  const details: ErrorDetails = {
    ...ownProperties,
    name: error.name || error.constructor.name,
    message: error.message,
  };

  if (error.cause instanceof Error) {
    details.cause = getErrorDetails(error.cause);
  }

  return details;
}

export function removeStackProperty(errorDetails: ErrorDetails): ErrorDetails {
  const { stack: _stack, ...rest } = errorDetails;

  if (isRecord(rest.cause) && 'name' in rest.cause && 'message' in rest.cause) {
    rest.cause = removeStackProperty(rest.cause as unknown as ErrorDetails);
  }

  return rest;
}

export function maybeRemoveStackProperty(errorDetails: ErrorDetails): ErrorDetails {
  return process.env.ACCOUNT_STAGE === 'prd' ? removeStackProperty(errorDetails) : errorDetails;
}
