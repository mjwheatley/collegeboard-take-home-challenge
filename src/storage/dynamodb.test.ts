import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';

import { DynamoDBStorage } from './dynamodb.js';

import type { CreateItemRequest, ExamItem } from '../types/item.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

const createRequest: CreateItemRequest = {
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B'],
    correctAnswer: 'A',
    explanation: 'It is a process.',
  },
  metadata: { author: 'author-1', status: 'draft', tags: ['biology'] },
  securityLevel: 'standard',
};

function toStoredItem(item: ExamItem, sk: string) {
  return { PK: item.id, SK: sk, ...item };
}

beforeEach(() => {
  ddbMock.reset();
  process.env.DYNAMODB_TABLE_NAME = 'ExamItemsTest';
});

describe('DynamoDBStorage.createItem', () => {
  it('writes latest, version, and audit records in one transaction', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const storage = new DynamoDBStorage();
    const item = await storage.createItem(createRequest);

    expect(item.metadata.version).toBe(1);

    const calls = ddbMock.commandCalls(TransactWriteCommand);

    expect(calls).toHaveLength(1);

    const transactItems = calls[0]?.args[0].input.TransactItems ?? [];

    expect(transactItems).toHaveLength(3);
    expect(transactItems[0]?.Put?.Item?.SK).toBe('latest');
    expect(transactItems[1]?.Put?.Item?.SK).toBe('VERSION#000001');
    expect(String(transactItems[2]?.Put?.Item?.SK)).toMatch(/^AUDIT#/);
    expect(transactItems[2]?.Put?.Item?.action).toBe('created');
    expect(transactItems[2]?.Put?.Item?.changedFields).toEqual([]);
  });
});

describe('DynamoDBStorage.getItem', () => {
  it('returns null when no item exists', async () => {
    ddbMock.on(GetCommand).resolves({});

    const storage = new DynamoDBStorage();

    expect(await storage.getItem('missing')).toBeNull();
  });

  it('strips PK/SK off the stored record', async () => {
    const item: ExamItem = {
      ...createRequest,
      id: 'item-1',
      metadata: { ...createRequest.metadata, created: 1, lastModified: 1, version: 1 },
    };

    ddbMock.on(GetCommand).resolves({ Item: toStoredItem(item, 'latest') });

    const storage = new DynamoDBStorage();
    const result = await storage.getItem('item-1');

    expect(result).toEqual(item);
  });
});

describe('DynamoDBStorage.updateItem', () => {
  it('returns null when the item does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});

    const storage = new DynamoDBStorage();

    expect(await storage.updateItem('missing', { difficulty: 5 })).toBeNull();
  });

  it('computes changedFields, bumps the version, and writes all 3 records', async () => {
    const existing: ExamItem = {
      ...createRequest,
      id: 'item-1',
      metadata: { ...createRequest.metadata, created: 1, lastModified: 1, version: 1 },
    };

    ddbMock.on(GetCommand).resolves({ Item: toStoredItem(existing, 'latest') });
    ddbMock.on(TransactWriteCommand).resolves({});

    const storage = new DynamoDBStorage();
    const updated = await storage.updateItem('item-1', { difficulty: 5 });

    expect(updated?.metadata.version).toBe(2);

    const transactItems = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];

    expect(transactItems[1]?.Put?.Item?.SK).toBe('VERSION#000002');
    expect(transactItems[2]?.Put?.Item?.action).toBe('updated');
    expect(transactItems[2]?.Put?.Item?.changedFields).toEqual(['difficulty']);
  });
});

describe('DynamoDBStorage.listItems', () => {
  it('filters out non-latest records and paginates client-side', async () => {
    const items: ExamItem[] = Array.from({ length: 3 }, (_, index) => ({
      ...createRequest,
      id: `item-${index}`,
      metadata: { ...createRequest.metadata, created: 1, lastModified: 1, version: 1 },
    }));

    ddbMock
      .on(ScanCommand)
      .resolves({ Items: items.map((item) => toStoredItem(item, 'latest')) });

    const storage = new DynamoDBStorage();
    const result = await storage.listItems({ limit: 2, offset: 0 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
  });
});

describe('DynamoDBStorage.getAuditTrail', () => {
  it('queries the AUDIT# prefix and strips keys', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { PK: 'item-1', SK: 'AUDIT#2026-01-01T00:00:00.000Z#000001', itemId: 'item-1', version: 1, action: 'created', changedBy: 'a', changedFields: [], timestamp: 1 },
      ],
    });

    const storage = new DynamoDBStorage();
    const trail = await storage.getAuditTrail('item-1');

    expect(trail).toEqual([
      { itemId: 'item-1', version: 1, action: 'created', changedBy: 'a', changedFields: [], timestamp: 1 },
    ]);

    const call = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;

    expect(call.ExpressionAttributeValues?.[':prefix']).toBe('AUDIT#');
    expect(call.ScanIndexForward).toBe(false);
  });
});
