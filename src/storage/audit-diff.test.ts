import { describe, expect, it } from 'vitest';

import { diffExamItemFields } from './audit-diff.js';

import type { ExamItem } from '../types/item.js';

const baseItem: ExamItem = {
  id: 'item-1',
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B'],
    correctAnswer: 'A',
    explanation: 'It is a process.',
  },
  metadata: {
    author: 'author-1',
    created: 1,
    lastModified: 1,
    version: 1,
    status: 'draft',
    tags: ['biology'],
  },
  securityLevel: 'standard',
};

describe('diffExamItemFields', () => {
  it('reports no changes for an empty update', () => {
    expect(diffExamItemFields(baseItem, {})).toEqual([]);
  });

  it('ignores fields resent with their existing value', () => {
    expect(diffExamItemFields(baseItem, { subject: baseItem.subject })).toEqual([]);
  });

  it('reports a changed top-level field', () => {
    expect(diffExamItemFields(baseItem, { difficulty: 5 })).toEqual(['difficulty']);
  });

  it('reports changed nested content fields individually', () => {
    expect(
      diffExamItemFields(baseItem, { content: { correctAnswer: 'B', explanation: baseItem.content.explanation } }),
    ).toEqual(['content.correctAnswer']);
  });

  it('reports a changed content.options array', () => {
    expect(diffExamItemFields(baseItem, { content: { options: ['A', 'B', 'C'] } })).toEqual(['content.options']);
  });

  it('reports changed metadata.status and metadata.tags', () => {
    expect(diffExamItemFields(baseItem, { metadata: { status: 'approved', tags: ['biology', 'cells'] } })).toEqual([
      'metadata.status',
      'metadata.tags',
    ]);
  });
});
