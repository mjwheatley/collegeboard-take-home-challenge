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
 *
 * `GSI1PK`/`GSI1SK` and `GSI2PK`/`GSI2SK` are only ever written on the `latest`
 * record (never on `VERSION#`/`AUDIT#` rows), which makes both indexes sparse: they
 * naturally contain one entry per item, with no need to additionally filter on `SK`.
 *   - GSI1 (`subject`): GSI1PK = subject, GSI1SK = `STATUS#<status>#<id>`
 *     — supports "by subject" and "by subject + status" lookups.
 *   - GSI2 (`status`):  GSI2PK = status,  GSI2SK = `SUBJECT#<subject>#<id>`
 *     — supports "by status" lookups.
 * These indexes are not yet provisioned in IaC (tracked separately); this module
 * only defines the item-side key shape they'd need.
 */

const VERSION_PAD_LENGTH = 6;

export const LATEST_SK = 'latest';

export const VERSION_SK_PREFIX = 'VERSION#';

export const AUDIT_SK_PREFIX = 'AUDIT#';

export const SUBJECT_INDEX_NAME = 'GSI1';

export const STATUS_INDEX_NAME = 'GSI2';

function padVersion(version: number): string {
  return String(version).padStart(VERSION_PAD_LENGTH, '0');
}

export function buildLatestKey(id: string): { PK: string; SK: string } {
  return { PK: id, SK: LATEST_SK };
}

export function buildListIndexAttributes(item: {
  id: string;
  subject: string;
  metadata: { status: string };
}): { GSI1PK: string; GSI1SK: string; GSI2PK: string; GSI2SK: string } {
  return {
    GSI1PK: item.subject,
    GSI1SK: `STATUS#${item.metadata.status}#${item.id}`,
    GSI2PK: item.metadata.status,
    GSI2SK: `SUBJECT#${item.subject}#${item.id}`,
  };
}

export function buildVersionKey(id: string, version: number): { PK: string; SK: string } {
  return { PK: id, SK: `${VERSION_SK_PREFIX}${padVersion(version)}` };
}

export function buildAuditKey(id: string, timestamp: number, version: number): { PK: string; SK: string } {
  return { PK: id, SK: `${AUDIT_SK_PREFIX}${new Date(timestamp).toISOString()}#${padVersion(version)}` };
}

/**
 * Strips the single-table key attributes (`PK`/`SK` plus the `GSI1*`/`GSI2*` list-index
 * attributes, when present) off a record before returning it to callers.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- intentional: callers specify the target type explicitly (e.g. stripKeys<ExamItem>(item)) instead of repeating `as ExamItem` at every call site.
export function stripKeys<T>(record: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, GSI2PK: _gsi2pk, GSI2SK: _gsi2sk, ...rest } = record;

  return rest as T;
}
