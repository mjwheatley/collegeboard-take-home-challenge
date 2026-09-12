import { describe, expect, it } from 'vitest';

import { getErrorDetails, removeStackProperty } from './error-details.js';

describe('getErrorDetails', () => {
  it('pulls name, message, and stack off a plain Error', () => {
    const error = new Error('boom');
    const details = getErrorDetails(error);

    expect(details.name).toBe('Error');
    expect(details.message).toBe('boom');
    expect(details.stack).toBeDefined();
  });

  it('includes custom own properties (e.g. HttpError-style statusCode/expose)', () => {
    const error = new Error('not found') as Error & { statusCode: number; expose: boolean };

    error.statusCode = 404;
    error.expose = true;

    const details = getErrorDetails(error);

    expect(details.statusCode).toBe(404);
    expect(details.expose).toBe(true);
  });

  it('recursively unwraps a cause chain', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    const details = getErrorDetails(error);

    expect(details.cause).toMatchObject({ name: 'Error', message: 'inner' });
  });
});

describe('removeStackProperty', () => {
  it('drops stack from the top-level error', () => {
    const details = getErrorDetails(new Error('boom'));

    expect(removeStackProperty(details).stack).toBeUndefined();
  });

  it('drops stack from a nested cause too', () => {
    const details = getErrorDetails(new Error('outer', { cause: new Error('inner') }));
    const result = removeStackProperty(details);

    expect(result.stack).toBeUndefined();
    expect((result.cause as { stack?: string }).stack).toBeUndefined();
    expect((result.cause as { message: string }).message).toBe('inner');
  });
});
