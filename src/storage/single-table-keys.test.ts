import { describe, expect, it } from 'vitest';

import { buildAuditKey, buildLatestKey, buildVersionKey, stripKeys } from './single-table-keys.js';

describe('single-table keys', () => {
  it('builds the latest-record key', () => {
    expect(buildLatestKey('item-1')).toEqual({ PK: 'item-1', SK: 'latest' });
  });

  it('zero-pads the version in the version-record key so lexical sort matches numeric sort', () => {
    expect(buildVersionKey('item-1', 1)).toEqual({ PK: 'item-1', SK: 'VERSION#000001' });
    expect(buildVersionKey('item-1', 42)).toEqual({ PK: 'item-1', SK: 'VERSION#000042' });

    const keys = [buildVersionKey('item-1', 2).SK, buildVersionKey('item-1', 10).SK].sort();

    expect(keys).toEqual(['VERSION#000002', 'VERSION#000010']);
  });

  it('builds an audit-record key prefixed with an ISO timestamp', () => {
    const key = buildAuditKey('item-1', Date.UTC(2026, 0, 1), 3);

    expect(key).toEqual({ PK: 'item-1', SK: 'AUDIT#2026-01-01T00:00:00.000Z#000003' });
  });

  it('strips PK/SK off a record', () => {
    expect(stripKeys<{ id: string }>({ PK: 'item-1', SK: 'latest', id: 'item-1' })).toEqual({ id: 'item-1' });
  });
});
