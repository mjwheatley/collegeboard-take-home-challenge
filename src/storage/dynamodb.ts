/**
 * DynamoDB Storage Implementation (Optional)
 *
 * Single-table design: partition key `PK` is the item id, sort key `SK` distinguishes
 * the record kind sharing that partition (`latest`, `VERSION#<n>`, `AUDIT#<ts>#<n>`)
 * — see `single-table-keys.ts`. Every write that changes an item's state (create,
 * update, explicit version bump) writes all three records atomically via
 * `TransactWriteCommand`, so `latest`/the version snapshot/the audit entry can never
 * drift out of sync with each other.
 *
 * To use this:
 * 1. Set environment variable: USE_DYNAMODB=true
 * 2. Configure AWS credentials (or use DynamoDB Local)
 * 3. Set DYNAMODB_TABLE_NAME (or use default "ExamItems")
 *
 * For DynamoDB Local:
 * - Download from: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 * - Run: java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb
 * - Set DYNAMODB_ENDPOINT=http://localhost:8000
 */

import { randomUUID } from 'crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery, PaginationQuery } from '../types/item.js';

import { diffExamItemFields } from './audit-diff.js';
import { ItemStorage } from './interface.js';
import {
  AUDIT_SK_PREFIX,
  LATEST_SK,
  STATUS_INDEX_NAME,
  SUBJECT_INDEX_NAME,
  VERSION_SK_PREFIX,
  buildAuditKey,
  buildLatestKey,
  buildListIndexAttributes,
  buildVersionKey,
  stripKeys,
} from './single-table-keys.js';

import type { AuditEntry } from '../types/audit.js';

// Scan's FilterExpression is applied after Limit is applied per page, so a single
// Scan call can under-return matching items even when more exist. This bounds how
// many pages listItems will page through rather than looping indefinitely against a
// pathological filter -- not a hard correctness guarantee for very large tables, but
// this is already a "Query with a GSI" problem in a real production table (see the
// note on listItems below).
const MAX_LIST_SCAN_PAGES = 20;

export class DynamoDBStorage implements ItemStorage {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && { endpoint: process.env.DYNAMODB_ENDPOINT }),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = process.env.DYNAMODB_TABLE_NAME ?? 'ExamItems';
  }

  async createItem(data: CreateItemRequest): Promise<ExamItem> {
    const now = Date.now();
    const item: ExamItem = {
      id: randomUUID(),
      ...data,
      metadata: {
        ...data.metadata,
        created: now,
        lastModified: now,
        version: 1,
      },
    };

    const auditEntry: AuditEntry = {
      itemId: item.id,
      version: 1,
      action: 'created',
      changedBy: item.metadata.author,
      changedFields: [],
      timestamp: now,
    };

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildLatestKey(item.id), ...buildListIndexAttributes(item), ...item },
            },
          },
          { Put: { TableName: this.tableName, Item: { ...buildVersionKey(item.id, 1), ...item } } },
          { Put: { TableName: this.tableName, Item: { ...buildAuditKey(item.id, now, 1), ...auditEntry } } },
        ],
      }),
    );

    return item;
  }

  async getItem(id: string): Promise<ExamItem | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: buildLatestKey(id),
      }),
    );

    return result.Item ? stripKeys<ExamItem>(result.Item) : null;
  }

  async updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null> {
    const existing = await this.getItem(id);

    if (!existing) return null;

    const changedFields = diffExamItemFields(existing, data);
    const now = Date.now();
    const updated: ExamItem = {
      ...existing,
      ...data,
      content: data.content ? { ...existing.content, ...data.content } : existing.content,
      metadata: {
        ...existing.metadata,
        ...(data.metadata ?? {}),
        lastModified: now,
        version: existing.metadata.version + 1,
      },
    };

    const auditEntry: AuditEntry = {
      itemId: id,
      version: updated.metadata.version,
      action: 'updated',
      changedBy: data.metadata?.author ?? existing.metadata.author,
      changedFields,
      timestamp: now,
    };

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildLatestKey(id), ...buildListIndexAttributes(updated), ...updated },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildVersionKey(id, updated.metadata.version), ...updated },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildAuditKey(id, now, updated.metadata.version), ...auditEntry },
            },
          },
        ],
      }),
    );

    return updated;
  }

  private async queryIndex(
    indexName: string,
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, unknown>,
  ): Promise<ExamItem[]> {
    const matched: ExamItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: indexName,
          KeyConditionExpression: keyConditionExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      matched.push(...(result.Items ?? []).map((item) => stripKeys<ExamItem>(item)));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return matched;
  }

  /**
   * Every item has 3 physical rows sharing a partition (latest/version/audit), so
   * Limit can't be passed straight through to Scan -- it would count the wrong rows
   * and could return zero matches on a page full of VERSION#/AUDIT# records even when
   * matching items exist elsewhere in the table. Pages through Scan (bounded by
   * MAX_LIST_SCAN_PAGES) collecting only `latest` records, then paginates client-side.
   */
  private async scanAllLatestItems(): Promise<ExamItem[]> {
    const matched: ExamItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    let scanPages = 0;

    do {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': LATEST_SK },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      matched.push(...(result.Items ?? []).map((item) => stripKeys<ExamItem>(item)));
      exclusiveStartKey = result.LastEvaluatedKey;
      scanPages += 1;
    } while (exclusiveStartKey && scanPages < MAX_LIST_SCAN_PAGES);

    return matched;
  }

  private async findMatchingLatestItems(query: ListItemsQuery): Promise<ExamItem[]> {
    if (query.subject && query.status) {
      return this.queryIndex(SUBJECT_INDEX_NAME, 'GSI1PK = :subject AND begins_with(GSI1SK, :statusPrefix)', {
        ':subject': query.subject,
        ':statusPrefix': `STATUS#${query.status}#`,
      });
    }

    if (query.subject) {
      return this.queryIndex(SUBJECT_INDEX_NAME, 'GSI1PK = :subject', { ':subject': query.subject });
    }

    if (query.status) {
      return this.queryIndex(STATUS_INDEX_NAME, 'GSI2PK = :status', { ':status': query.status });
    }

    return this.scanAllLatestItems();
  }

  /**
   * When a `subject` and/or `status` filter is given, this Queries the sparse
   * GSI1/GSI2 indexes (see `single-table-keys.ts`) instead of Scanning the table --
   * those indexes only ever contain `latest` records, so every page returned is
   * already a match with no client-side filtering needed. `subject` alone or
   * `subject` + `status` both use GSI1 (status narrows via `begins_with` on GSI1SK);
   * `status` alone uses GSI2.
   *
   * With no filters there's no selective key to Query on, so this falls back to the
   * bounded Scan (see `scanAllLatestItems`) -- listing literally everything has no
   * way around a full-table read in this design.
   *
   * GSI1/GSI2 are provisioned in `infra/resources/database.ts`.
   */
  async listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }> {
    const matched = await this.findMatchingLatestItems(query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 10;

    return { items: matched.slice(offset, offset + limit), total: matched.length };
  }

  async createVersion(id: string): Promise<ExamItem | null> {
    const existing = await this.getItem(id);

    if (!existing) return null;

    const now = Date.now();
    const newVersion: ExamItem = {
      ...existing,
      metadata: {
        ...existing.metadata,
        version: existing.metadata.version + 1,
        lastModified: now,
      },
    };

    const auditEntry: AuditEntry = {
      itemId: id,
      version: newVersion.metadata.version,
      action: 'version_created',
      changedBy: existing.metadata.author,
      changedFields: [],
      timestamp: now,
    };

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildLatestKey(id), ...buildListIndexAttributes(newVersion), ...newVersion },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildVersionKey(id, newVersion.metadata.version), ...newVersion },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...buildAuditKey(id, now, newVersion.metadata.version), ...auditEntry },
            },
          },
        ],
      }),
    );

    return newVersion;
  }

  /**
   * Queries a single partition's VERSION# records, newest first, then paginates
   * client-side. Unlike listItems, this is a single-partition Query (not a
   * cross-partition Scan), so it doesn't need the multi-page loop -- a Query already
   * returns matching sort keys efficiently and in order; the only remaining gap is
   * that a version history larger than 1MB of results would need LastEvaluatedKey
   * pagination too, which isn't handled here (an item would need thousands of
   * versions to hit that).
   */
  async listVersions(id: string, query: PaginationQuery): Promise<{ items: ExamItem[]; total: number }> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': id, ':prefix': VERSION_SK_PREFIX },
        ScanIndexForward: false, // newest first
      }),
    );

    const snapshots = (result.Items ?? []).map((item) => stripKeys<ExamItem>(item));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 10;

    return { items: snapshots.slice(offset, offset + limit), total: snapshots.length };
  }

  async getAuditTrail(id: string): Promise<AuditEntry[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': id, ':prefix': AUDIT_SK_PREFIX },
        ScanIndexForward: false, // newest first
      }),
    );

    return (result.Items ?? []).map((item) => stripKeys<AuditEntry>(item));
  }
}
