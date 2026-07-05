// Tolerant parser for the prompted single-JSON-action protocol (agent.ts). The model is asked to reply
// with ONLY one JSON object like {"action":"run_sql","sql":"…"} or {"action":"emit_report", …}. A weak
// reasoning model still occasionally wraps it in a ```json fence, prepends a stray sentence, or echoes
// the object twice — so we do NOT `JSON.parse` the whole content or use a naive regex. Instead: strip
// fences, scan for every balanced top-level {…} object (string/escape aware), and take the LAST one that
// carries a recognised `action` key (last-wins defeats the "echoed twice / CoT-then-JSON" habits).
//
// Pure + dependency-free — unit-tested in isolation (json-action.test.ts).

export interface ParsedAction {
  /** The tool/terminal name, e.g. 'run_sql' | 'emit_report' | 'find_entity' | … */
  action: string;
  /** Every other field of the object — passed as the tool args / emit_report input. */
  args: Record<string, unknown>;
}

export interface ParseActionResult {
  /** The parsed action, or null when no balanced object with a string `action` was found. */
  action: ParsedAction | null;
  /** true when nothing parseable was found (caller nudges or falls back). */
  recovered: boolean;
}

/**
 * Scan `text` for every balanced, top-level `{…}` object, tracking string literals and escapes so a
 * brace inside a JSON string never miscounts. Returns the raw substrings in source order.
 */
export function jsonObjectCandidates(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j; // resume scanning after this object
          break;
        }
      }
    }
  }
  return out;
}

/** Strip a leading `<think>…</think>` / `thought …` block a reasoning model may prepend to prose. */
export function stripReasoning(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(?:thought|разсъждение)\b[\s\S]*?(?=\{|$)/i, '')
    .trim();
}

/**
 * Parse the model's reply into a single action. Fence-strip → balanced-object scan → last-candidate that
 * has a string `action` wins. `args` is the object minus `action` (fed straight to the tool / emit_report).
 */
export function parseAction(content: string | null): ParseActionResult {
  const raw = (content ?? '').trim();
  const text = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const candidates = jsonObjectCandidates(text);
  for (let k = candidates.length - 1; k >= 0; k--) {
    let obj: unknown;
    try {
      obj = JSON.parse(candidates[k]!);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      if (typeof rec.action === 'string' && rec.action.length > 0) {
        const { action, ...args } = rec;
        return { action: { action: String(action), args }, recovered: false };
      }
    }
  }
  return { action: null, recovered: true };
}
