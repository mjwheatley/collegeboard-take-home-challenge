/**
 * Storage Interface
 *
 * This interface defines the contract for item storage.
 * Implement this interface for different storage backends (in-memory, DynamoDB, etc.)
 */

import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery, PaginationQuery } from '../types/item.js';

import type { AuditEntry } from '../types/audit.js';

export interface ItemStorage {
  createItem(data: CreateItemRequest): Promise<ExamItem>;
  getItem(id: string): Promise<ExamItem | null>;
  updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null>;
  listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }>;
  createVersion(id: string): Promise<ExamItem | null>;
  /** Paginated version history (newest first) — full `ExamItem` snapshots, not the audit change-log. */
  listVersions(id: string, query: PaginationQuery): Promise<{ items: ExamItem[]; total: number }>;
  getAuditTrail(id: string): Promise<AuditEntry[]>;
}
