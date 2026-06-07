import { describe, expect, it } from 'vitest';

import { deleteSqlForEopSources } from './load-eop.mjs';

describe('deleteSqlForEopSources', () => {
  it('keeps the existing single-day source wipe', () => {
    expect(deleteSqlForEopSources('raw_egov_contracts', 'contracts', ['2024-01-02'])).toBe(
      "DELETE FROM raw_egov_contracts WHERE source = 'eop:contracts:2024-01-02';\n",
    );
  });

  it('scopes multi-day wipes to the requested window', () => {
    const sql = deleteSqlForEopSources('raw_egov_contracts', 'contracts', [
      '2024-01-02',
      '2024-01-03',
    ]);

    expect(sql).toBe(
      "DELETE FROM raw_egov_contracts WHERE source IN (\n  'eop:contracts:2024-01-02',\n  'eop:contracts:2024-01-03'\n);\n",
    );
    expect(sql).not.toContain("source LIKE 'eop:contracts:%'");
  });
});
