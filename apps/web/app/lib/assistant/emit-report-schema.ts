// emit_report shape validation + the model-facing JSON Schema.
//
// Two-stage validation of what the model emits (spec §4: "invalid output → the model retries"):
//   1. validateEmitShape (here)   — is it STRUCTURALLY a valid EmitReportInput? (block types, required
//      fields). Hand-rolled so it stays dependency-free and unit-testable.
//   2. bindReport (report-schema) — do the result-handle REFERENCES resolve, and re-bind real values.
// The JSON Schema is the contract handed to the model via the tool definition (the AI SDK can take a
// zod schema or this JSON Schema). Pure — no deps/bindings.

import type { CellFormat, CellRef, EmitReportInput } from './report-schema';

const FORMATS = new Set<CellFormat>(['money', 'number', 'percent', 'date', 'text']);
const BLOCK_TYPES = new Set([
  'text',
  'callout',
  'totals',
  'facts',
  'table',
  'bar',
  'flows',
  'timeseries',
]);

const ENTITY_KINDS = new Set(['company', 'authority', 'contract']);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
// row indices are 0-based, non-negative INTEGERS. A non-integer (1.5) slips bindReport's `row < length`
// range check, then `rows[1.5]` is undefined and the slot silently binds null (review #80).
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isFormat = (v: unknown): v is CellFormat => isStr(v) && FORMATS.has(v as CellFormat);
// A table column's optional entity link. `kind` must be a known EntityKind (it reaches entityHref,
// where an unknown kind silently builds a wrong-entity `/contracts/…` citation — review #80).
const isLink = (v: unknown): boolean =>
  v === undefined ||
  (isObj(v) && isStr(v.kind) && ENTITY_KINDS.has(v.kind) && isNonEmptyStr(v.idCol));

function isCellRef(v: unknown): v is CellRef {
  return isObj(v) && isNonEmptyStr(v.resultId) && isIndex(v.row) && isNonEmptyStr(v.col);
}

export type ShapeResult = { ok: true; value: EmitReportInput } | { ok: false; errors: string[] };

// Tolerant normalization (defense-in-depth): weak models emit near-miss field names. Canonicalize the
// common misses BEFORE strict validation so a structurally-correct report isn't rejected on a synonym.
// Pairs with BLOCK_SCHEMA_GUIDE in system-prompt.ts. (fix: emit_report schema adherence)
const BLOCK_TYPE_ALIASES: Record<string, string> = {
  fact: 'facts',
  total: 'totals',
  flow: 'flows',
  timeserie: 'timeseries',
};

function normalizeEmitInput(input: unknown): unknown {
  if (!isObj(input) || !Array.isArray(input.blocks)) return input;
  const blocks = input.blocks.map((b) => {
    if (!isObj(b)) return b;
    const nb: Record<string, unknown> = { ...b };
    if (isStr(nb.type)) nb.type = BLOCK_TYPE_ALIASES[nb.type] ?? nb.type;
    // text/callout body: accept `content`/`text` as aliases for `md`
    if ((nb.type === 'text' || nb.type === 'callout') && !isStr(nb.md)) {
      if (isStr(nb.content)) nb.md = nb.content;
      else if (isStr(nb.text)) nb.md = nb.text;
    }
    return nb;
  });
  return { ...input, blocks };
}

/** Structurally validate a model-emitted report. On success the value is a typed EmitReportInput. */
export function validateEmitShape(rawInput: unknown): ShapeResult {
  const input = normalizeEmitInput(rawInput);
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['report must be an object'] };
  if (!isNonEmptyStr(input.title)) errors.push('title must be a non-empty string');
  if (!isStr(input.question)) errors.push('question must be a string');
  if (!Array.isArray(input.blocks)) {
    errors.push('blocks must be an array');
    return { ok: false, errors };
  }

  input.blocks.forEach((b, i) => {
    const at = `block[${i}]`;
    if (!isObj(b) || !isStr(b.type) || !BLOCK_TYPES.has(b.type)) {
      errors.push(`${at}: invalid or missing "type"`);
      return;
    }
    const need = (cond: boolean, msg: string) => {
      if (!cond) errors.push(`${at} (${b.type as string}): ${msg}`);
    };
    switch (b.type) {
      case 'text':
        need(isStr(b.md), 'md must be a string');
        break;
      case 'callout':
        need(isNonEmptyStr(b.title), 'title required');
        need(isStr(b.md), 'md must be a string');
        break;
      case 'totals':
        need(Array.isArray(b.items), 'items must be an array');
        if (Array.isArray(b.items))
          b.items.forEach((it, j) =>
            need(
              isObj(it) && isStr(it.label) && isCellRef(it.ref) && isFormat(it.format),
              `items[${j}] needs {label, ref:{resultId,row,col}, format}`,
            ),
          );
        break;
      case 'facts':
        need(Array.isArray(b.items), 'items must be an array');
        if (Array.isArray(b.items))
          b.items.forEach((it, j) =>
            need(isObj(it) && isStr(it.term) && isCellRef(it.ref), `items[${j}] needs {term, ref}`),
          );
        break;
      case 'table':
        need(isNonEmptyStr(b.resultId), 'resultId required');
        need(Array.isArray(b.columns) && b.columns.length > 0, 'columns must be a non-empty array');
        if (Array.isArray(b.columns))
          b.columns.forEach((c, j) =>
            need(
              isObj(c) &&
                isNonEmptyStr(c.key) &&
                isStr(c.header) &&
                isFormat(c.format) &&
                isLink(c.link),
              `columns[${j}] needs {key, header, format, link?:{kind:company|authority|contract, idCol}}`,
            ),
          );
        break;
      case 'bar':
        need(isNonEmptyStr(b.resultId), 'resultId required');
        need(
          isNonEmptyStr(b.labelCol) && isNonEmptyStr(b.valueCol),
          'labelCol and valueCol required',
        );
        break;
      case 'flows':
        need(isNonEmptyStr(b.resultId), 'resultId required');
        need(
          isNonEmptyStr(b.fromCol) && isNonEmptyStr(b.toCol) && isNonEmptyStr(b.valueCol),
          'fromCol, toCol and valueCol required',
        );
        break;
      case 'timeseries':
        need(isNonEmptyStr(b.resultId), 'resultId required');
        need(
          isNonEmptyStr(b.periodCol) && isNonEmptyStr(b.valueCol),
          'periodCol and valueCol required',
        );
        break;
    }
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as EmitReportInput };
}

// Model-facing contract for the emit_report tool. Kept pragmatic: it requires `type` and the common
// shape; validateEmitShape enforces the strict per-type rules server-side.
export const EMIT_REPORT_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'question', 'blocks'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Кратко заглавие на справката (на български)' },
    question: {
      type: 'string',
      description: 'Зададеният от потребителя въпрос (показва се на справката)',
    },
    blocks: {
      type: 'array',
      minItems: 1,
      description:
        'Блокове на справката. Числата НЕ се пишат тук — препращат към резултатни хендъли (ref:{resultId,row,col}) или resultId+колони; сървърът свързва стойностите.',
      items: {
        type: 'object',
        required: ['type'],
        // Per-type field shapes (the server enforces these strictly in validateEmitShape). Listed here
        // so the model emits the right field NAMES, not synonyms. (fix: emit_report schema adherence)
        description:
          'Блок. Полета по тип: ' +
          'text→{type,md}; callout→{type,title,md}; ' +
          'totals→{type,items:[{label,ref:{resultId,row,col},format}]}; ' +
          'facts→{type,items:[{term,ref:{resultId,row,col}}]}; ' +
          'table→{type,resultId,columns:[{key,header,format,link?}]}; ' +
          'bar→{type,resultId,labelCol,valueCol}; ' +
          'flows→{type,resultId,fromCol,toCol,valueCol}; ' +
          'timeseries→{type,resultId,periodCol,valueCol}. ' +
          'Текстът е в "md" (НЕ "content"/"text"); числата само чрез "ref".',
        properties: {
          type: {
            enum: ['text', 'callout', 'totals', 'facts', 'table', 'bar', 'flows', 'timeseries'],
          },
          md: { type: 'string', description: 'Markdown тяло за text/callout (БЕЗ числа)' },
          title: { type: 'string', description: 'Заглавие за callout' },
          items: {
            type: 'array',
            description: 'За totals: {label,ref,format}. За facts: {term,ref}. ref={resultId,row,col}.',
          },
          ref: {
            type: 'object',
            description: 'Препратка към резултатен хендъл',
            properties: {
              resultId: { type: 'string' },
              row: { type: 'integer' },
              col: { type: 'string' },
            },
          },
          resultId: { type: 'string', description: 'Хендъл за table/bar/flows/timeseries (напр. R1)' },
          columns: { type: 'array', description: 'За table: [{key,header,format,link?}]' },
          labelCol: { type: 'string' },
          valueCol: { type: 'string' },
          fromCol: { type: 'string' },
          toCol: { type: 'string' },
          periodCol: { type: 'string' },
          format: { enum: ['money', 'number', 'percent', 'date', 'text'] },
        },
      },
    },
  },
} as const;
