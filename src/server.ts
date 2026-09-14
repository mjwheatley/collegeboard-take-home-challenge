/**
 * Local Development Server
 *
 * Without SST's Live Lambda proxy (see DECISIONS.md — this branch is the CDK version
 * of the IaC, which has no equivalent), there's no dev-mode bridge from a real API
 * Gateway to locally-running handler code. This is the pre-SST approach restored:
 * a plain `http` server that runs the same Middy handlers `items.ts` exports.
 *
 * The handlers (via `createMiddyfiedRestHandler`) are typed and tested against a real
 * `APIGatewayProxyEventV2`/`APIGatewayProxyStructuredResultV2` shape — CORS, header
 * normalization, JSON body parsing, and Zod validation middleware all read fields off
 * that specific event shape (`rawPath`, `headers`, `requestContext.http.method`, a
 * string `body`, etc). Rather than adapting the handlers to a simpler local-only
 * shape, this constructs a real (synthetic) `APIGatewayProxyEventV2` from the raw
 * Node request for every route, so the exact same handler code path runs locally as
 * in Lambda. Run with: pnpm dev
 */

import { randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';

import {
  createItemHandler,
  createVersionHandler,
  getAuditTrailHandler,
  getItemHandler,
  listItemsHandler,
  listVersionsHandler,
  updateItemHandler,
} from './handlers/items.js';

import type { MiddyfiedHandler } from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';

const PORT = Number(process.env.PORT ?? 3000);

interface RouteDefinition {
  method: string;
  // Path segments: a literal string, or `:name` for a captured path parameter.
  segments: string[];
  handler: MiddyfiedHandler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>;
}

const asMiddyHandler = (
  handler: unknown,
): MiddyfiedHandler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2> =>
  handler as MiddyfiedHandler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>;

const ROUTES: RouteDefinition[] = [
  { method: 'GET', segments: ['api', 'items'], handler: asMiddyHandler(listItemsHandler) },
  { method: 'POST', segments: ['api', 'items'], handler: asMiddyHandler(createItemHandler) },
  { method: 'GET', segments: ['api', 'items', ':id'], handler: asMiddyHandler(getItemHandler) },
  { method: 'PUT', segments: ['api', 'items', ':id'], handler: asMiddyHandler(updateItemHandler) },
  { method: 'POST', segments: ['api', 'items', ':id', 'versions'], handler: asMiddyHandler(createVersionHandler) },
  { method: 'GET', segments: ['api', 'items', ':id', 'versions'], handler: asMiddyHandler(listVersionsHandler) },
  { method: 'GET', segments: ['api', 'items', ':id', 'audit'], handler: asMiddyHandler(getAuditTrailHandler) },
];

function matchRoute(method: string, path: string): { route: RouteDefinition; pathParameters: Record<string, string> } | undefined {
  const pathSegments = path.split('/').filter(Boolean);

  for (const route of ROUTES) {
    if (route.method !== method || route.segments.length !== pathSegments.length) {
      continue;
    }

    const pathParameters: Record<string, string> = {};
    const isMatch = route.segments.every((segment, index) => {
      if (segment.startsWith(':')) {
        pathParameters[segment.slice(1)] = pathSegments[index];

        return true;
      }

      return segment === pathSegments[index];
    });

    if (isMatch) {
      return { route, pathParameters };
    }
  }

  return undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function toSingleValuedRecord(searchParams: URLSearchParams): Record<string, string> {
  const record: Record<string, string> = {};

  for (const [key, value] of searchParams.entries()) {
    record[key] = value;
  }

  return record;
}

function toHeadersRecord(rawHeaders: IncomingMessage['headers']): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(',') : value;
    }
  }

  return headers;
}

/**
 * Builds a real `APIGatewayProxyEventV2` from a raw Node request, so it flows through
 * the same Middy middleware stack (CORS, header normalization, JSON body parsing, Zod
 * validation, ...) a deployed handler would see from an actual API Gateway HTTP API.
 */
function buildEvent(
  req: IncomingMessage,
  method: string,
  body: string,
  route: RouteDefinition,
  pathParameters: Record<string, string>,
  url: URL,
): APIGatewayProxyEventV2 {
  const routeKey = `${method} /${route.segments.map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment)).join('/')}`;
  const nowIso = new Date().toISOString();

  return {
    version: '2.0',
    routeKey,
    rawPath: url.pathname,
    rawQueryString: url.search.replace(/^\?/, ''),
    headers: toHeadersRecord(req.headers),
    queryStringParameters: url.search ? toSingleValuedRecord(url.searchParams) : undefined,
    pathParameters: Object.keys(pathParameters).length > 0 ? pathParameters : undefined,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress ?? '127.0.0.1',
        userAgent: req.headers['user-agent'] ?? '',
      },
      requestId: randomUUID(),
      routeKey,
      stage: '$default',
      time: nowIso,
      timeEpoch: Date.now(),
    },
    body: body.length > 0 ? body : undefined,
    isBase64Encoded: false,
  };
}

const noopContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'local-dev-server',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:local-dev-server',
  memoryLimitInMB: '128',
  awsRequestId: randomUUID(),
  logGroupName: '/local/dev',
  logStreamName: 'local',
  getRemainingTimeInMillis: () => 30000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

function writeResult(res: ServerResponse, result: APIGatewayProxyStructuredResultV2) {
  const statusCode = result.statusCode ?? 200;

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, String(value));
  }

  res.writeHead(statusCode);
  res.end(result.body ?? '');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  console.log(`${method} ${url.pathname}`);

  // No API Gateway here to handle CORS preflight itself (see `corsMiddleware.ts`) —
  // it has to be answered directly instead of routed into a handler.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();

    return;
  }

  const matched = matchRoute(method, url.pathname);

  if (!matched) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));

    return;
  }

  const body = await readBody(req);
  const event = buildEvent(req, method, body, matched.route, matched.pathParameters, url);

  try {
    const result = await matched.route.handler(event, noopContext);

    writeResult(res, result);
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET    http://localhost:${PORT}/api/items`);
  console.log(`  POST   http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id`);
  console.log(`  PUT    http://localhost:${PORT}/api/items/:id`);
  console.log(`  POST   http://localhost:${PORT}/api/items/:id/versions`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id/versions`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id/audit`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
