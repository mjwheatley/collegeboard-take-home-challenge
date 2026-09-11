/**
 * Example Handler
 *
 * This demonstrates how to create a handler for the API.
 * You can use this as a template for implementing the required endpoints.
 *
 * `getItemHandler`/`createItemHandler` are the public, Middy-wrapped entry points:
 * each validates its event against a Zod schema before the underlying logic runs, and
 * its response before returning. The event shape here is the already-normalized
 * request payload (e.g. `{ id }`, or the create request body) — mapping a real API
 * Gateway event into that shape belongs to whatever sits in front of these handlers
 * once they're deployed, not to these handlers themselves.
 */

import middy from '@middy/core';
import { literal, object, string, union } from 'zod';

import { zodValidatorMiddleware } from '../middleware/zodValidatorMiddleware.js';
import { createStorage } from '../storage/index.js';
import { CreateItemRequestSchema, ExamItemSchema, type CreateItemRequest } from '../types/item.js';

const storage = createStorage();

const errorBodySchema = object({ error: string() });

async function getItem(id: string) {
  try {
    const item = await storage.getItem(id);

    if (!item) {
      return {
        statusCode: 404,
        body: { error: 'Item not found' },
      };
    }

    return {
      statusCode: 200,
      body: item,
    };
  } catch (error) {
    console.error('Error getting item:', error);

    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}

const getItemEventSchema = object({ id: string() });

const getItemResponseSchema = union([
  object({ statusCode: literal(200), body: ExamItemSchema }),
  object({ statusCode: literal(404), body: errorBodySchema }),
  object({ statusCode: literal(500), body: errorBodySchema }),
]);

export const getItemHandler = middy<{ id: string }, Awaited<ReturnType<typeof getItem>>>(async (event: {
  id: string;
}) => getItem(event.id)).use(
  zodValidatorMiddleware({ requestSchema: getItemEventSchema, responseSchema: getItemResponseSchema }),
);

async function createItem(data: CreateItemRequest) {
  try {
    const item = await storage.createItem(data);

    return {
      statusCode: 201,
      body: item,
    };
  } catch (error) {
    console.error('Error creating item:', error);

    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}

const createItemResponseSchema = union([
  object({ statusCode: literal(201), body: ExamItemSchema }),
  object({ statusCode: literal(500), body: errorBodySchema }),
]);

export const createItemHandler = middy<CreateItemRequest, Awaited<ReturnType<typeof createItem>>>(
  async (event: CreateItemRequest) => createItem(event),
).use(
  zodValidatorMiddleware({ requestSchema: CreateItemRequestSchema, responseSchema: createItemResponseSchema }),
);

// TODO: Implement other handlers:
// - updateItemHandler
// - listItemsHandler
// - createVersionHandler
// - getAuditTrailHandler
