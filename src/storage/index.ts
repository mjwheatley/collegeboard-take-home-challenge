/**
 * Storage Factory
 *
 * Automatically selects the appropriate storage backend based on environment variables.
 * Defaults to in-memory storage for easy local development.
 */

import { DynamoDBStorage } from './dynamodb.js';
import { ItemStorage } from './interface.js';
import { MemoryStorage } from './memory.js';

export function createStorage(): ItemStorage {
  if (process.env.USE_DYNAMODB === 'true') {
    console.log('📦 Using DynamoDB storage');

    return new DynamoDBStorage();
  }

  console.log('📦 Using in-memory storage');

  return new MemoryStorage();
}

export * from './interface.js';
