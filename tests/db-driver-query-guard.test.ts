import { describe, expect, it } from 'vitest';
import { assertReadOnlySelect } from '../src/main/mcp/infra-drivers/db-driver';

describe('assertReadOnlySelect', () => {
  it('allows plain read-only statements', () => {
    expect(() => assertReadOnlySelect('SELECT * FROM users')).not.toThrow();
    expect(() => assertReadOnlySelect('  select id from users  ')).not.toThrow();
    expect(() => assertReadOnlySelect('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow();
    expect(() => assertReadOnlySelect('SHOW STATUS')).not.toThrow();
    expect(() => assertReadOnlySelect('EXPLAIN SELECT * FROM users')).not.toThrow();
    expect(() => assertReadOnlySelect('DESCRIBE users')).not.toThrow();
    expect(() => assertReadOnlySelect('DESC users')).not.toThrow();
    expect(() =>
      assertReadOnlySelect('SELECT * FROM users JOIN roles ON users.role_id = roles.id')
    ).not.toThrow();
    expect(() =>
      assertReadOnlySelect(
        'SELECT id, name FROM (SELECT * FROM users WHERE active = true) AS filtered'
      )
    ).not.toThrow();
  });

  it('allows a single trailing semicolon', () => {
    expect(() => assertReadOnlySelect('SELECT * FROM users;')).not.toThrow();
  });

  it('rejects write/DDL statements', () => {
    expect(() => assertReadOnlySelect('INSERT INTO users VALUES (1)')).toThrow();
    expect(() => assertReadOnlySelect('UPDATE users SET name = 1')).toThrow();
    expect(() => assertReadOnlySelect('DELETE FROM users')).toThrow();
    expect(() => assertReadOnlySelect('DROP TABLE users')).toThrow();
    expect(() => assertReadOnlySelect('ALTER TABLE users ADD COLUMN x int')).toThrow();
    expect(() => assertReadOnlySelect('TRUNCATE TABLE users')).toThrow();
    expect(() => assertReadOnlySelect('CREATE VIEW user_view AS SELECT * FROM users')).toThrow();
    expect(() => assertReadOnlySelect('GRANT SELECT ON users TO user_role')).toThrow();
  });

  it('rejects statement-stacking attempts', () => {
    expect(() => assertReadOnlySelect('SELECT 1; DROP TABLE users;')).toThrow();
    expect(() => assertReadOnlySelect('SELECT 1; SELECT 2')).toThrow();
    expect(() => assertReadOnlySelect('SELECT 1; INSERT INTO users VALUES (1)')).toThrow();
  });
});
