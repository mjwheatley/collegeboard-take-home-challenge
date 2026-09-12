/**
 * Item Handlers
 *
 * Each is wired through `createMiddyfiedRestHandler` (see
 * `createMiddyfiedRestHandler.ts`), which handles CORS, JSON body parsing, response
 * serialization, structured logging, and mapping any thrown error into a JSON error
 * response -- so these handler functions only need to express the actual business
 * logic: read `pathParameters`/`body`/`queryStringParameters` off the (already
 * validated) event, call storage, throw `NotFoundError` for the one expected failure
 * case, and return `{ statusCode, body }` for success. Any other thrown error (a bug,
 * a DynamoDB failure) is handled generically by `jsonErrorMessageMiddleware` --
 * there's deliberately no catch-all try/catch here that would swallow it before the
 * logger/error-formatting middleware ever sees it.
 */

import { literal, number, object, string } from 'zod';

import { NotFoundError } from '../errors/NotFoundError.js';
import { createStorage } from '../storage/index.js';
import { AuditEntrySchema } from '../types/audit.js';
import {
  CreateItemRequestSchema,
  ExamItemSchema,
  ListItemsQuerySchema,
  PaginationQuerySchema,
  UpdateItemRequestSchema,
  type CreateItemRequest,
  type ListItemsQuery,
  type PaginationQuery,
  type UpdateItemRequest,
} from '../types/item.js';
import { StatusCode } from '../util/http-status.js';

import { type MiddyHandler } from './createMiddyfiedHandler.js';
import { createMiddyfiedRestHandler } from './createMiddyfiedRestHandler.js';

import type { APIGatewayProxyEventV2JsonParsedBody, WithPathParameters } from '../types/api-gateway.js';

const storage = createStorage();

const idPathParamSchema = object({ id: string() }).passthrough();

// ---- getItem ----

type GetItemEvent = WithPathParameters<APIGatewayProxyEventV2JsonParsedBody, 'id'>;

async function getItem(event: GetItemEvent) {
  const { id } = event.pathParameters;
  const item = await storage.getItem(id);

  if (!item) {
    throw new NotFoundError('Item not found');
  }

  return { statusCode: StatusCode.Ok, body: item };
}

const getItemRequestSchema = object({ pathParameters: idPathParamSchema }).passthrough();

const getItemResponseSchema = object({ statusCode: literal(StatusCode.Ok), body: ExamItemSchema });

export const getItemHandler = createMiddyfiedRestHandler(getItem as MiddyHandler, {
  requestSchema: getItemRequestSchema,
  responseSchema: getItemResponseSchema,
});

// ---- createItem ----

type CreateItemEvent = Omit<APIGatewayProxyEventV2JsonParsedBody, 'body'> & { body: CreateItemRequest };

async function createItem(event: CreateItemEvent) {
  const item = await storage.createItem(event.body);

  return { statusCode: StatusCode.Created, body: item };
}

const createItemRequestSchema = object({ body: CreateItemRequestSchema }).passthrough();

const createItemResponseSchema = object({ statusCode: literal(StatusCode.Created), body: ExamItemSchema });

export const createItemHandler = createMiddyfiedRestHandler(createItem as MiddyHandler, {
  requestSchema: createItemRequestSchema,
  responseSchema: createItemResponseSchema,
});

// ---- updateItem ----

type UpdateItemEvent = WithPathParameters<Omit<APIGatewayProxyEventV2JsonParsedBody, 'body'> & { body: UpdateItemRequest }, 'id'>;

async function updateItem(event: UpdateItemEvent) {
  const { id } = event.pathParameters;
  const item = await storage.updateItem(id, event.body);

  if (!item) {
    throw new NotFoundError('Item not found');
  }

  return { statusCode: StatusCode.Ok, body: item };
}

const updateItemRequestSchema = object({ pathParameters: idPathParamSchema, body: UpdateItemRequestSchema }).passthrough();

const updateItemResponseSchema = object({ statusCode: literal(StatusCode.Ok), body: ExamItemSchema });

export const updateItemHandler = createMiddyfiedRestHandler(updateItem as MiddyHandler, {
  requestSchema: updateItemRequestSchema,
  responseSchema: updateItemResponseSchema,
});

// ---- listItems ----

type ListItemsEvent = Omit<APIGatewayProxyEventV2JsonParsedBody, 'queryStringParameters'> & {
  queryStringParameters?: ListItemsQuery;
};

async function listItems(event: ListItemsEvent) {
  const result = await storage.listItems(event.queryStringParameters ?? {});

  return { statusCode: StatusCode.Ok, body: result };
}

const listItemsRequestSchema = object({ queryStringParameters: ListItemsQuerySchema.optional() }).passthrough();

const listItemsResponseSchema = object({
  statusCode: literal(StatusCode.Ok),
  body: object({ items: ExamItemSchema.array(), total: number() }),
});

export const listItemsHandler = createMiddyfiedRestHandler(listItems as MiddyHandler, {
  requestSchema: listItemsRequestSchema,
  responseSchema: listItemsResponseSchema,
});

// ---- createVersion ----

type CreateVersionEvent = WithPathParameters<APIGatewayProxyEventV2JsonParsedBody, 'id'>;

async function createVersion(event: CreateVersionEvent) {
  const { id } = event.pathParameters;
  const item = await storage.createVersion(id);

  if (!item) {
    throw new NotFoundError('Item not found');
  }

  return { statusCode: StatusCode.Created, body: item };
}

const createVersionRequestSchema = object({ pathParameters: idPathParamSchema }).passthrough();

const createVersionResponseSchema = object({ statusCode: literal(StatusCode.Created), body: ExamItemSchema });

export const createVersionHandler = createMiddyfiedRestHandler(createVersion as MiddyHandler, {
  requestSchema: createVersionRequestSchema,
  responseSchema: createVersionResponseSchema,
});

// ---- listVersions ----

type ListVersionsEvent = WithPathParameters<
  Omit<APIGatewayProxyEventV2JsonParsedBody, 'queryStringParameters'> & { queryStringParameters?: PaginationQuery },
  'id'
>;

async function listVersions(event: ListVersionsEvent) {
  const { id } = event.pathParameters;
  const result = await storage.listVersions(id, event.queryStringParameters ?? {});

  return { statusCode: StatusCode.Ok, body: result };
}

const listVersionsRequestSchema = object({
  pathParameters: idPathParamSchema,
  queryStringParameters: PaginationQuerySchema.optional(),
}).passthrough();

const listVersionsResponseSchema = object({
  statusCode: literal(StatusCode.Ok),
  body: object({ items: ExamItemSchema.array(), total: number() }),
});

export const listVersionsHandler = createMiddyfiedRestHandler(listVersions as MiddyHandler, {
  requestSchema: listVersionsRequestSchema,
  responseSchema: listVersionsResponseSchema,
});

// ---- getAuditTrail ----

type GetAuditTrailEvent = WithPathParameters<APIGatewayProxyEventV2JsonParsedBody, 'id'>;

async function getAuditTrail(event: GetAuditTrailEvent) {
  const { id } = event.pathParameters;
  const trail = await storage.getAuditTrail(id);

  return { statusCode: StatusCode.Ok, body: trail };
}

const getAuditTrailRequestSchema = object({ pathParameters: idPathParamSchema }).passthrough();

const getAuditTrailResponseSchema = object({ statusCode: literal(StatusCode.Ok), body: AuditEntrySchema.array() });

export const getAuditTrailHandler = createMiddyfiedRestHandler(getAuditTrail as MiddyHandler, {
  requestSchema: getAuditTrailRequestSchema,
  responseSchema: getAuditTrailResponseSchema,
});
