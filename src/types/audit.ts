/**
 * Audit trail entry
 *
 * A lightweight change-log record — who changed what, when — distinct from a full
 * `ExamItem` version snapshot. `action` maps 1:1 to the storage operation that
 * produced the entry: `createItem` -> "created", `updateItem` -> "updated",
 * `createVersion` -> "version_created" (an explicit version bump with no field
 * changes, matching `POST /api/items/:id/versions`).
 */

import { enum as zodEnum, number, object, string, type z } from 'zod';

export const AuditActionSchema = zodEnum(['created', 'updated', 'version_created']);

export const AuditEntrySchema = object({
  itemId: string(),
  version: number(),
  action: AuditActionSchema,
  changedBy: string(),
  changedFields: string().array(),
  timestamp: number(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;
