/**
 * In-Memory Storage Implementation
 *
 * This is a simple in-memory storage for local development and testing.
 * Data is lost when the server restarts.
 */

import { randomUUID } from 'crypto';

import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery, PaginationQuery } from '../types/item.js';

import { diffExamItemFields } from './audit-diff.js';
import { ItemStorage } from './interface.js';

import type { AuditEntry } from '../types/audit.js';

export class MemoryStorage implements ItemStorage {
  private items = new Map<string, ExamItem>();
  private versions = new Map<string, ExamItem[]>();
  private auditLog = new Map<string, AuditEntry[]>();

  private recordVersionSnapshot(snapshot: ExamItem): void {
    const snapshots = this.versions.get(snapshot.id) ?? [];

    snapshots.push(snapshot);
    this.versions.set(snapshot.id, snapshots);
  }

  private recordAuditEntry(entry: AuditEntry): void {
    const entries = this.auditLog.get(entry.itemId) ?? [];

    entries.push(entry);
    this.auditLog.set(entry.itemId, entries);
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

    this.items.set(item.id, item);
    this.recordVersionSnapshot(item);
    this.recordAuditEntry({
      itemId: item.id,
      version: 1,
      action: 'created',
      changedBy: item.metadata.author,
      changedFields: [],
      timestamp: now,
    });

    return item;
  }

  async getItem(id: string): Promise<ExamItem | null> {
    return this.items.get(id) ?? null;
  }

  async updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null> {
    const item = this.items.get(id);

    if (!item) return null;

    const changedFields = diffExamItemFields(item, data);
    const now = Date.now();
    const updated: ExamItem = {
      ...item,
      ...data,
      content: data.content ? { ...item.content, ...data.content } : item.content,
      metadata: {
        ...item.metadata,
        ...(data.metadata ?? {}),
        lastModified: now,
        version: item.metadata.version + 1,
      },
    };

    this.items.set(id, updated);
    this.recordVersionSnapshot(updated);
    this.recordAuditEntry({
      itemId: id,
      version: updated.metadata.version,
      action: 'updated',
      changedBy: data.metadata?.author ?? item.metadata.author,
      changedFields,
      timestamp: now,
    });

    return updated;
  }

  async listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }> {
    let items = Array.from(this.items.values());

    // Filter by subject
    if (query.subject) {
      items = items.filter((item) => item.subject === query.subject);
    }

    // Filter by status
    if (query.status) {
      items = items.filter((item) => item.metadata.status === query.status);
    }

    const total = items.length;

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 10;

    items = items.slice(offset, offset + limit);

    return { items, total };
  }

  async createVersion(id: string): Promise<ExamItem | null> {
    const item = this.items.get(id);

    if (!item) return null;

    const now = Date.now();

    // Create a new version (copy of current state, no field changes)
    const newVersion: ExamItem = {
      ...item,
      metadata: {
        ...item.metadata,
        version: item.metadata.version + 1,
        lastModified: now,
      },
    };

    this.items.set(id, newVersion);
    this.recordVersionSnapshot(newVersion);
    this.recordAuditEntry({
      itemId: id,
      version: newVersion.metadata.version,
      action: 'version_created',
      changedBy: item.metadata.author,
      changedFields: [],
      timestamp: now,
    });

    return newVersion;
  }

  async listVersions(id: string, query: PaginationQuery): Promise<{ items: ExamItem[]; total: number }> {
    const snapshots = [...(this.versions.get(id) ?? [])].reverse();
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 10;

    return { items: snapshots.slice(offset, offset + limit), total: snapshots.length };
  }

  async getAuditTrail(id: string): Promise<AuditEntry[]> {
    return [...(this.auditLog.get(id) ?? [])].reverse();
  }
}
