/**
 * Single-table key helpers for the exam items table.
 *
 * Partition key `PK` is the item id; sort key `SK` distinguishes the record kind
 * sharing that partition:
 *   - `latest`                        — the current full `ExamItem`
 *   - `VERSION#<zero-padded version>` — a full `ExamItem` snapshot as of that version
 *   - `AUDIT#<ISO timestamp>#<zero-padded version>` — a lightweight `AuditEntry`
 *
 * Versions are zero-padded so lexical (string) sort order matches numeric order
 * regardless of digit count; audit entries are prefixed with an ISO timestamp so a
 * `Query` naturally returns them in chronological order.
 */

const VERSION_PAD_LENGTH = 6;

export const LATEST_SK = 'latest';

export const VERSION_SK_PREFIX = 'VERSION#';

export const AUDIT_SK_PREFIX = 'AUDIT#';

function padVersion(version: number): string {
  return String(version).padStart(VERSION_PAD_LENGTH, '0');
}

export function buildLatestKey(id: string): { PK: string; SK: string } {
  return { PK: id, SK: LATEST_SK };
}

export function buildVersionKey(id: string, version: number): { PK: string; SK: string } {
  return { PK: id, SK: `${VERSION_SK_PREFIX}${padVersion(version)}` };
}

export function buildAuditKey(id: string, timestamp: number, version: number): { PK: string; SK: string } {
  return { PK: id, SK: `${AUDIT_SK_PREFIX}${new Date(timestamp).toISOString()}#${padVersion(version)}` };
}

/** Strips the single-table key attributes (`PK`/`SK`) off a record before returning it to callers. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- intentional: callers specify the target type explicitly (e.g. stripKeys<ExamItem>(item)) instead of repeating `as ExamItem` at every call site.
export function stripKeys<T>(record: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, ...rest } = record;

  return rest as T;
}
