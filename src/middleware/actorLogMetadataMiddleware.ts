import { logger } from '../logging/logger.js';

import type { APIGatewayProxyEventV2JsonParsedBody } from '../types/api-gateway.js';
import type { MiddlewareObj } from '@middy/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the caller identity from a Cognito JWT authorizer's claims (API Gateway
 * HTTP API v2 shape: `requestContext.authorizer.jwt.claims`) and appends it as
 * persistent logger keys, so every log emitted during the request includes actor
 * identity metadata.
 *
 * Throws if the shape isn't present -- callers are expected to catch this. Auth
 * (Cognito) isn't wired up yet (see "Authentication (deferred)" in DECISIONS.md), so
 * today every invocation takes this path and no actor metadata is logged; this is
 * ready to work as soon as a JWT authorizer is attached to the API.
 */
function getAuditLogActor(authorizer: unknown): Record<string, unknown> {
  if (!isRecord(authorizer) || !isRecord(authorizer.jwt) || !isRecord(authorizer.jwt.claims)) {
    throw new Error('No JWT authorizer claims present on this event');
  }

  const { claims } = authorizer.jwt;

  return {
    id: claims.sub,
    username: claims['cognito:username'] ?? claims.username,
    email: claims.email,
  };
}

export const actorLogMetadataMiddleware = (): MiddlewareObj<APIGatewayProxyEventV2JsonParsedBody> => {
  const appendActorKeys: MiddlewareObj<APIGatewayProxyEventV2JsonParsedBody>['before'] = (request) => {
    try {
      // The base APIGatewayProxyEventV2 type has no `authorizer` field at all (it only
      // appears when a route actually has one attached, via a narrower event type) --
      // this cast is what lets getAuditLogActor's own runtime check do the real work.
      const requestContext = request.event.requestContext as unknown as Record<string, unknown>;
      const actor = getAuditLogActor(requestContext.authorizer);

      logger.appendKeys({ actor });
    } catch {
      // Authorizer context may be absent (local dev, tests, or auth simply not wired
      // up yet) -- continue without actor metadata rather than blocking the request.
    }
  };

  const removeActorKeys: MiddlewareObj<APIGatewayProxyEventV2JsonParsedBody>['after'] = () => {
    logger.removeKeys(['actor']);
  };

  return {
    before: appendActorKeys,
    after: removeActorKeys,
    onError: removeActorKeys,
  };
};
