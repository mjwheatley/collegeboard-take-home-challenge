/**
 * Exam Item Types
 *
 * Zod schemas are the source of truth here; every exported type is derived via
 * `z.infer` rather than hand-written, so the request/response shapes and their
 * runtime validation (see the Zod middleware wired up in the handlers) can never
 * drift apart the way three separately maintained interfaces could.
 */

import { enum as zodEnum, number, object, string, type z } from 'zod';

const ExamItemContentSchema = object({
  question: string(),
  options: string().array().optional(), // For multiple choice
  correctAnswer: string(),
  explanation: string(),
});

const ItemTypeSchema = zodEnum(['multiple-choice', 'free-response', 'essay']);

const ItemStatusSchema = zodEnum(['draft', 'review', 'approved', 'archived']);

const SecurityLevelSchema = zodEnum(['standard', 'secure', 'highly-secure']);

const ExamItemMetadataSchema = object({
  author: string(),
  created: number(), // timestamp
  lastModified: number(), // timestamp
  version: number(),
  status: ItemStatusSchema,
  tags: string().array(),
});

export const ExamItemSchema = object({
  id: string(),
  subject: string(), // e.g., "AP Biology", "AP Calculus"
  itemType: ItemTypeSchema,
  difficulty: number().int().min(1).max(5),
  content: ExamItemContentSchema,
  metadata: ExamItemMetadataSchema,
  securityLevel: SecurityLevelSchema,
});

export type ExamItem = z.infer<typeof ExamItemSchema>;

const CreateExamItemMetadataSchema = ExamItemMetadataSchema.omit({
  created: true,
  lastModified: true,
  version: true,
});

export const CreateItemRequestSchema = ExamItemSchema.omit({
  id: true,
  metadata: true,
}).extend({
  metadata: CreateExamItemMetadataSchema,
});

export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = object({
  subject: ExamItemSchema.shape.subject.optional(),
  itemType: ExamItemSchema.shape.itemType.optional(),
  difficulty: ExamItemSchema.shape.difficulty.optional(),
  content: ExamItemContentSchema.partial().optional(),
  metadata: ExamItemMetadataSchema.partial().optional(),
  securityLevel: ExamItemSchema.shape.securityLevel.optional(),
});

export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const ListItemsQuerySchema = object({
  limit: number().int().positive().optional(),
  offset: number().int().min(0).optional(),
  subject: string().optional(),
  status: ItemStatusSchema.optional(),
});

export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;
