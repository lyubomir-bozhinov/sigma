import { describe, expect, it } from 'vitest';
import { jsonObjectCandidates, parseAction, stripReasoning } from './json-action';

describe('jsonObjectCandidates', () => {
  it('extracts a single top-level object', () => {
    expect(jsonObjectCandidates('{"action":"run_sql"}')).toEqual(['{"action":"run_sql"}']);
  });

  it('ignores braces inside string literals', () => {
    const s = '{"sql":"SELECT json_extract(x,\'{a}\') FROM t"}';
    expect(jsonObjectCandidates(s)).toEqual([s]);
  });

  it('finds multiple sibling objects in source order', () => {
    expect(jsonObjectCandidates('{"a":1} noise {"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles nested objects as one candidate', () => {
    expect(jsonObjectCandidates('{"x":{"y":1}}')).toEqual(['{"x":{"y":1}}']);
  });
});

describe('parseAction', () => {
  it('parses a bare action object', () => {
    expect(parseAction('{"action":"run_sql","sql":"SELECT 1"}')).toEqual({
      action: { action: 'run_sql', args: { sql: 'SELECT 1' } },
      recovered: false,
    });
  });

  it('strips ```json fences', () => {
    const r = parseAction('```json\n{"action":"describe_schema"}\n```');
    expect(r.action).toEqual({ action: 'describe_schema', args: {} });
    expect(r.recovered).toBe(false);
  });

  it('takes the LAST action when the model echoes CoT then JSON (last-wins)', () => {
    const content =
      'thought: I should first look. {"action":"describe_schema"} Now the real one: ' +
      '{"action":"run_sql","sql":"SELECT COUNT(*) FROM contracts"}';
    expect(parseAction(content).action).toEqual({
      action: 'run_sql',
      args: { sql: 'SELECT COUNT(*) FROM contracts' },
    });
  });

  it('separates action from args (emit_report shape)', () => {
    const r = parseAction('{"action":"emit_report","title":"T","question":"Q","blocks":[]}');
    expect(r.action).toEqual({
      action: 'emit_report',
      args: { title: 'T', question: 'Q', blocks: [] },
    });
  });

  it('flags recovered when there is no JSON object at all', () => {
    expect(parseAction('just prose, no json')).toEqual({ action: null, recovered: true });
  });

  it('flags recovered when the object has no string action key', () => {
    expect(parseAction('{"foo":"bar"}')).toEqual({ action: null, recovered: true });
  });

  it('skips an unparseable candidate and uses an earlier valid one', () => {
    // The trailing object is invalid JSON (trailing comma); the earlier valid one wins.
    const r = parseAction('{"action":"run_sql","sql":"SELECT 1"} {"action":"x",}');
    expect(r.action).toEqual({ action: 'run_sql', args: { sql: 'SELECT 1' } });
  });

  it('handles null/empty content', () => {
    expect(parseAction(null)).toEqual({ action: null, recovered: true });
    expect(parseAction('')).toEqual({ action: null, recovered: true });
  });
});

describe('stripReasoning', () => {
  it('removes a <think> block', () => {
    expect(stripReasoning('<think>hmm</think>Готово.')).toBe('Готово.');
  });

  it('leaves plain prose intact', () => {
    expect(stripReasoning('Здравей.')).toBe('Здравей.');
  });
});
