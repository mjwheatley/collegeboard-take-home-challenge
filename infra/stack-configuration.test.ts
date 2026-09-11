import { describe, expect, it } from 'vitest';

import { getStackConfiguration } from './stack-configuration.js';

describe('getStackConfiguration', () => {
  it('uses INFO log level for the named long-running stages', () => {
    expect(getStackConfiguration('production').LOG_LEVEL).toBe('INFO');
    expect(getStackConfiguration('staging').LOG_LEVEL).toBe('INFO');
  });

  it('uses DEBUG log level for everything else', () => {
    expect(getStackConfiguration('matt').LOG_LEVEL).toBe('DEBUG');
    expect(getStackConfiguration('pr-123').LOG_LEVEL).toBe('DEBUG');
  });
});
