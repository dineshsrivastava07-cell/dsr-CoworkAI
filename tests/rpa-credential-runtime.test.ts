import { afterEach, describe, expect, it } from 'vitest';
import {
  _setRuntimeCredentialsForTesting,
  fillCredentialParams,
  redactCredentialSecrets,
  resolveCredentialProfile,
} from '../src/main/mcp/rpa-credential-runtime';

afterEach(() => {
  _setRuntimeCredentialsForTesting([]);
});

describe('RPA credential runtime', () => {
  it('resolves and substitutes a profile without returning credentials in redacted logs', () => {
    _setRuntimeCredentialsForTesting([
      { name: 'erp', username: 'operator@example.com', password: 's3cret' },
    ]);
    expect(resolveCredentialProfile('erp')).toMatchObject({ name: 'erp' });
    const args = fillCredentialParams(
      { text: '{{credential.username}}/{{credential.password}}' },
      'erp'
    );
    expect(args.text).toBe('operator@example.com/s3cret');
    expect(redactCredentialSecrets(args)).toEqual({ text: '[REDACTED]/[REDACTED]' });
  });

  it('fails closed when a scheduled recipe references a missing profile', () => {
    _setRuntimeCredentialsForTesting([]);
    expect(() => fillCredentialParams({ text: '{{credential.password}}' }, 'missing')).toThrow(
      'unavailable'
    );
  });

  it('substitutes nested placeholders and resolves profile names case-insensitively', () => {
    _setRuntimeCredentialsForTesting([
      { name: 'Finance ERP', username: 'operator', password: 'secret-value' },
    ]);

    expect(
      fillCredentialParams(
        { nested: { values: ['{{credential.username}}', '{{credential.password}}'] } },
        'finance erp'
      )
    ).toEqual({ nested: { values: ['operator', 'secret-value'] } });
  });
});
