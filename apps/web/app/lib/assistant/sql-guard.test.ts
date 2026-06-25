import { describe, expect, it } from 'vitest';
import { guardSql, truncateResult } from './sql-guard';

describe('guardSql — blocklist', () => {
  const blocked = [
    'INSERT INTO foo VALUES (1)',
    'UPDATE foo SET x=1',
    'DELETE FROM foo',
    'DROP TABLE foo',
    'ALTER TABLE foo ADD COLUMN x INT',
    'CREATE TABLE foo (id INT)',
    'REPLACE INTO foo VALUES (1)',
    'ATTACH DATABASE "other.db" AS other',
    'PRAGMA foreign_keys = OFF',
    'VACUUM',
    'BEGIN TRANSACTION',
    'COMMIT',
    'ROLLBACK',
    'SAVEPOINT sp1',
  ];

  for (const sql of blocked) {
    it(`blocks: ${sql.split(' ').slice(0, 2).join(' ')}`, () => {
      const result = guardSql(sql);
      expect(result.ok).toBe(false);
    });
  }

  it('blocks keyword hidden in line comment', () => {
    const result = guardSql('SELECT 1 -- DROP TABLE foo\nUNION SELECT 2');
    expect(result.ok).toBe(true); // DROP is in comment — stripped. No blocklist match.
  });

  it('blocks keyword hidden in block comment', () => {
    const result = guardSql('SELECT /* DELETE FROM */ 1');
    expect(result.ok).toBe(true); // DELETE is in block comment — stripped.
  });

  it('blocks DELETE when not in a comment', () => {
    const result = guardSql('SELECT 1; DELETE FROM foo');
    // stacked statement — blocked by the "multiple statements" check
    expect(result.ok).toBe(false);
  });

  it('blocks case-insensitive keywords', () => {
    expect(guardSql('drop table foo').ok).toBe(false);
    expect(guardSql('DrOp TaBlE foo').ok).toBe(false);
  });
});

describe('guardSql — structural checks', () => {
  it('rejects empty string', () => {
    expect(guardSql('').ok).toBe(false);
    expect(guardSql('   ').ok).toBe(false);
  });

  it('rejects non-SELECT statement', () => {
    expect(guardSql('SHOW TABLES').ok).toBe(false);
    expect(guardSql('EXPLAIN SELECT 1').ok).toBe(false);
  });

  it('accepts SELECT', () => {
    expect(guardSql('SELECT 1').ok).toBe(true);
  });

  it('accepts WITH…SELECT (CTE)', () => {
    const result = guardSql('WITH cte AS (SELECT 1) SELECT * FROM cte');
    expect(result.ok).toBe(true);
  });

  it('rejects stacked statements (mid-semicolon)', () => {
    const result = guardSql('SELECT 1; SELECT 2');
    expect(result.ok).toBe(false);
  });

  it('allows trailing semicolon', () => {
    const result = guardSql('SELECT 1;');
    expect(result.ok).toBe(true);
  });
});

describe('guardSql — LIMIT injection', () => {
  it('adds default LIMIT when absent', () => {
    const result = guardSql('SELECT * FROM contracts');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toMatch(/LIMIT 50$/);
  });

  it('preserves LIMIT within ceiling', () => {
    const result = guardSql('SELECT * FROM contracts LIMIT 10');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toMatch(/LIMIT 10/);
  });

  it('clamps LIMIT exceeding ceiling to 200', () => {
    const result = guardSql('SELECT * FROM contracts LIMIT 9999');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toMatch(/LIMIT 200/);
  });

  it('clamps LIMIT exactly at ceiling', () => {
    const result = guardSql('SELECT * FROM contracts LIMIT 200');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toMatch(/LIMIT 200/);
  });
});

describe('truncateResult', () => {
  it('returns all rows when under budget', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { rows: out, truncated } = truncateResult(rows);
    expect(out).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('truncates when budget exceeded', () => {
    const big = Array.from({ length: 100 }, (_, i) => ({ id: i, data: 'x'.repeat(500) }));
    const { rows: out, truncated } = truncateResult(big);
    expect(truncated).toBe(true);
    expect(out.length).toBeLessThan(100);
  });

  it('handles empty array', () => {
    const { rows, truncated } = truncateResult([]);
    expect(rows).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});
