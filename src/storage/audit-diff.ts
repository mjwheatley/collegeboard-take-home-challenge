/**
 * Computes which fields an `UpdateItemRequest` actually changes relative to the
 * existing item, for the audit trail's `changedFields`. Only fields present in the
 * request are considered — and only flagged if the value differs from the current
 * one, so re-sending an unchanged value isn't recorded as a change.
 */

import type { ExamItem, UpdateItemRequest } from '../types/item.js';

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function diffExamItemFields(existing: ExamItem, data: UpdateItemRequest): string[] {
  const changedFields: string[] = [];

  if (data.subject !== undefined && data.subject !== existing.subject) {
    changedFields.push('subject');
  }

  if (data.itemType !== undefined && data.itemType !== existing.itemType) {
    changedFields.push('itemType');
  }

  if (data.difficulty !== undefined && data.difficulty !== existing.difficulty) {
    changedFields.push('difficulty');
  }

  if (data.securityLevel !== undefined && data.securityLevel !== existing.securityLevel) {
    changedFields.push('securityLevel');
  }

  if (data.content) {
    for (const field of ['question', 'correctAnswer', 'explanation'] as const) {
      const value = data.content[field];

      if (value !== undefined && value !== existing.content[field]) {
        changedFields.push(`content.${field}`);
      }
    }

    if (data.content.options !== undefined && !arraysEqual(data.content.options, existing.content.options ?? [])) {
      changedFields.push('content.options');
    }
  }

  if (data.metadata) {
    if (data.metadata.status !== undefined && data.metadata.status !== existing.metadata.status) {
      changedFields.push('metadata.status');
    }

    if (data.metadata.tags !== undefined && !arraysEqual(data.metadata.tags, existing.metadata.tags)) {
      changedFields.push('metadata.tags');
    }

    if (data.metadata.author !== undefined && data.metadata.author !== existing.metadata.author) {
      changedFields.push('metadata.author');
    }
  }

  return changedFields;
}
