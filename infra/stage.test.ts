import { describe, expect, it } from 'vitest';

import { AccountStage, resolveAccountStage } from './stage.js';

describe('AccountStage', () => {
  it('uses 3-letter env-style values', () => {
    expect(AccountStage.Development).toBe('dev');
    expect(AccountStage.Staging).toBe('stg');
    expect(AccountStage.Production).toBe('prd');
  });
});

describe('resolveAccountStage', () => {
  it('resolves named long-running stages', () => {
    expect(resolveAccountStage('production')).toBe(AccountStage.Production);
    expect(resolveAccountStage('Production')).toBe(AccountStage.Production);
    expect(resolveAccountStage('prod')).toBe(AccountStage.Production);
    expect(resolveAccountStage('staging')).toBe(AccountStage.Staging);
    expect(resolveAccountStage('stage')).toBe(AccountStage.Staging);
  });

  it('falls back to Development for personal dev stages and PR previews', () => {
    expect(resolveAccountStage('matt')).toBe(AccountStage.Development);
    expect(resolveAccountStage('pr-123')).toBe(AccountStage.Development);
    expect(resolveAccountStage('dev')).toBe(AccountStage.Development);
  });
});
