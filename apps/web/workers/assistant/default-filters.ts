// E3 — Guard A: default filters.
//
// When the assistant queries the contracts corpus it must apply the safe defaults deterministically,
// not at the model's discretion: exclude suspect-value rows (they would distort sums), exclude
// synthetic tenders (procedure_type = 'неизвестна', headers we fabricated for orphan contracts), and
// reason about time by `signed_at` (when the deal was struck) rather than `published_at`. Each
// default can be explicitly opted out of, but every opt-out emits a callout line naming the risk, so
// the assumption is always surfaced to the reader. This module is pure: it produces the descriptor,
// the callout, and a parameterized SQL fragment the query layer appends — it never runs SQL.

export type DateField = 'signed_at' | 'published_at';

export interface DefaultFilterOptions {
  /** Include rows flagged `value_suspect` (distorts monetary sums). */
  includeValueSuspect?: boolean;
  /** Include synthetic tenders (procedure_type = 'неизвестна'). */
  includeSynthetic?: boolean;
  /** Reason about time by this column. Defaults to `signed_at`. */
  dateField?: DateField;
}

export interface DefaultFilterDescriptor {
  excludeValueSuspect: boolean;
  excludeSynthetic: boolean;
  dateField: DateField;
}

export interface DefaultFilterResult {
  descriptor: DefaultFilterDescriptor;
  /** Qualified column to use for date ordering/range, e.g. `c.signed_at`. */
  dateColumn: string;
  /** Callout lines surfaced to the reader; defaults plus an explicit warning per opt-out. */
  callout: string[];
  /** Parameterized WHERE conditions (no leading WHERE) to AND into the contracts query. */
  sql: { fragment: string; params: unknown[] };
}

const VALUE_SUSPECT = 'value_suspect';
const SYNTHETIC_PROCEDURE = 'неизвестна';

const DATE_COLUMN: Record<DateField, string> = {
  signed_at: 'c.signed_at',
  published_at: 'c.published_at',
};

const CALLOUT_DEFAULT_VALUE_SUSPECT =
  'По подразбиране са изключени договори със съмнителна стойност (value_suspect).';
const CALLOUT_DEFAULT_SYNTHETIC =
  'По подразбиране са изключени синтетични поръчки с неизвестна процедура.';
const CALLOUT_DEFAULT_SIGNED_AT = 'Времевият анализ е по дата на подписване (signed_at).';
const CALLOUT_OPTOUT_VALUE_SUSPECT =
  'ВНИМАНИЕ: по изрично искане са включени договори със съмнителна стойност (value_suspect); сумите може да са изкривени.';
const CALLOUT_OPTOUT_SYNTHETIC =
  'ВНИМАНИЕ: по изрично искане са включени синтетични поръчки (неизвестна процедура).';
const CALLOUT_OPTOUT_PUBLISHED_AT =
  'ВНИМАНИЕ: по изрично искане времевият анализ е по дата на публикуване (published_at) вместо signed_at.';

/**
 * Resolve the default contract filters against an explicit opt-out set. Deterministic and pure.
 */
export function applyDefaultFilters(options: DefaultFilterOptions = {}): DefaultFilterResult {
  const excludeValueSuspect = options.includeValueSuspect !== true;
  const excludeSynthetic = options.includeSynthetic !== true;
  const dateField: DateField = options.dateField ?? 'signed_at';

  const callout: string[] = [];
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (excludeValueSuspect) {
    conditions.push('c.value_flag != ?');
    params.push(VALUE_SUSPECT);
    callout.push(CALLOUT_DEFAULT_VALUE_SUSPECT);
  } else {
    callout.push(CALLOUT_OPTOUT_VALUE_SUSPECT);
  }

  if (excludeSynthetic) {
    // Keep rows whose procedure is NULL (not synthetic) — only the sentinel is excluded.
    conditions.push('(t.procedure_type IS NULL OR t.procedure_type != ?)');
    params.push(SYNTHETIC_PROCEDURE);
    callout.push(CALLOUT_DEFAULT_SYNTHETIC);
  } else {
    callout.push(CALLOUT_OPTOUT_SYNTHETIC);
  }

  callout.push(dateField === 'signed_at' ? CALLOUT_DEFAULT_SIGNED_AT : CALLOUT_OPTOUT_PUBLISHED_AT);

  return {
    descriptor: { excludeValueSuspect, excludeSynthetic, dateField },
    dateColumn: DATE_COLUMN[dateField],
    callout,
    sql: { fragment: conditions.join(' AND '), params },
  };
}
