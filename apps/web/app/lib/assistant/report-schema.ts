// Report block vocabulary + server-side value binding.
//
// Integrity rule (spec §4 + §9 point 1): the model NEVER writes data values. It emits blocks that
// *reference* handles into result sets the server actually executed (run_sql / curated tools); the
// server re-binds the real values. A 27B model that fabricates a row or writes 12 млрд. instead of
// 1,2 млрд. therefore cannot reach a published, citable report — the defamation/disinfo vector in
// architecture.md §3. Only `text`/`callout` carry model prose; it is markdown-sanitized (no raw
// HTML — closes the stored-XSS vector on the public /reports/:id, spec §7) and must not carry
// material numbers.
//
// This module is pure (no deps, no bindings) so it is unit-testable and deploy-independent.

export type CellFormat = 'money' | 'number' | 'percent' | 'date' | 'text';
export type EntityKind = 'company' | 'authority' | 'contract';

/**
 * A result set the server obtained from a server-executed tool. `handle` is what the model uses to
 * reference it (e.g. "R1"). Values are primitives only — never markup. Rows are aligned to columns.
 */
export interface QueryResult {
  handle: string;
  columns: string[];
  rows: (string | number | null)[][];
  truncated?: boolean; // run_sql byte/row cap hit (spec §7) — surfaced in the callout
}

// A pointer to a single cell in a result set. The only way the model can place a number anywhere.
export interface CellRef {
  resultId: string;
  row: number;
  col: string;
}

// ── What the MODEL emits via emit_report (no literal data values in data blocks) ──────────────────
export interface EmitText {
  type: 'text';
  md: string;
}
export interface EmitCallout {
  type: 'callout';
  title: string;
  md: string;
}
export interface EmitTotals {
  type: 'totals';
  items: { label: string; ref: CellRef; format: CellFormat }[];
}
export interface EmitFacts {
  type: 'facts';
  items: { term: string; ref: CellRef; sub?: string }[];
}
export interface EmitTableColumn {
  key: string; // must name a column of the referenced result
  header: string;
  align?: 'left' | 'right';
  format: CellFormat;
  link?: { kind: EntityKind; idCol: string }; // renderer builds the canonical /companies/:eik etc.
}
export interface EmitTable {
  type: 'table';
  resultId: string; // rows come wholesale from this result — the model cannot inject fabricated rows
  columns: EmitTableColumn[];
}
export interface EmitBar {
  type: 'bar';
  resultId: string;
  labelCol: string;
  valueCol: string;
  format?: CellFormat;
}
export interface EmitFlows {
  type: 'flows';
  resultId: string;
  fromCol: string;
  toCol: string;
  valueCol: string;
}
export interface EmitTimeseries {
  type: 'timeseries';
  resultId: string;
  periodCol: string;
  valueCol: string;
  format?: CellFormat;
}
export type EmitBlock =
  | EmitText
  | EmitCallout
  | EmitTotals
  | EmitFacts
  | EmitTable
  | EmitBar
  | EmitFlows
  | EmitTimeseries;

export interface EmitReportInput {
  title: string;
  question: string; // the asked question — shown on the report (watermark, spec §9 point 12)
  blocks: EmitBlock[];
}

// ── What the RENDERER consumes (resolved, server-owned values) ────────────────────────────────────
export interface ResolvedRow {
  cells: (string | number | null)[];
  // Raw entity id per column for columns that declare a `link` (else null), aligned to `columns`.
  // The renderer builds the canonical href via entityHref(kind, id); kept separate so the id need not
  // be a visible column (§4 "links by entity-ref, not URL"). Without this an immutable R2 report could
  // not reconstruct its links.
  links?: (string | null)[];
}
export type ResolvedBlock =
  | { type: 'text'; md: string }
  | { type: 'callout'; title: string; md: string }
  | {
      type: 'totals';
      items: { label: string; value: string | number | null; format: CellFormat }[];
    }
  | { type: 'facts'; items: { term: string; value: string | number | null; sub?: string }[] }
  // `truncated` is set when the backing result hit the run_sql byte cap — the renderer surfaces a
  // "results truncated" indicator so a capped table/chart never reads as complete (review #80).
  | {
      type: 'table';
      columns: EmitTableColumn[];
      rows: ResolvedRow[];
      truncated?: boolean;
    }
  | {
      type: 'bar';
      points: { label: string | number | null; value: number }[];
      truncated?: boolean;
      format?: CellFormat;
    }
  | {
      type: 'flows';
      edges: { from: string; to: string; valueEur: number }[];
      truncated?: boolean;
    }
  | {
      type: 'timeseries';
      points: { period: string | number | null; value: number }[];
      truncated?: boolean;
      format?: CellFormat;
    };

export interface ResolvedReport {
  title: string;
  question: string;
  blocks: ResolvedBlock[];
  watermark: 'ai-generated'; // renderer always shows the „AI-генерирано, неофициално" label (§9.12)
}

export type BindResult =
  | { ok: true; report: ResolvedReport; warnings: string[] }
  | { ok: false; errors: string[] };

export interface BindOptions {
  // Server-authoritative question text (the actual latest user message), set by the chat route. When
  // present it OWNS the displayed question instead of the model's echo — closing the vector where the
  // model places an unbound material number in the question slot, and guaranteeing the shown question
  // is the one the user actually asked. When absent (model-only path), the model's question is gated
  // for material numbers like all other model-authored text (§9.1 / guardrail E2, review #80).
  question?: string;
}

// Strip raw HTML in a SINGLE LINEAR pass: scan left-to-right; when a `<` begins a tag (`<`, optional
// `/`, then a letter) skip to the next `>`. O(n), and it inherently handles nested/overlapping input
// (`<scr<script>ipt>` — the `<…>` is consumed greedily, leaving inert text) with NO fixpoint loop. The
// previous `/<[^>]*>/g` was QUADRATIC on input with many `<` and no `>`: each `<` re-scanned to EOL for a
// `>` that never comes, so one crafted ~64 KB cell (sanitizeCell runs this on up to 500 untrusted result
// rows) burned seconds of single-request Worker CPU (review #80). A `<` that does NOT begin a tag (a
// genuine `3 < 5`) is kept verbatim; a trailing unterminated tag-open drops the rest.
function stripTags(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      out += s.slice(i);
      break;
    }
    const nameChar = s[lt + 1] === '/' ? s[lt + 2] : s[lt + 1];
    if (nameChar !== undefined && /[a-zA-Z]/.test(nameChar)) {
      out += s.slice(i, lt); // text before the tag
      const close = s.indexOf('>', lt + 1);
      if (close === -1) break; // trailing unterminated tag-open → drop the rest
      i = close + 1;
    } else {
      out += s.slice(i, lt + 1); // keep a non-tag '<' verbatim
      i = lt + 1;
    }
  }
  return out;
}

// Until the Phase-2 markdown renderer (no raw-HTML passthrough) lands, this strip is the SOLE barrier
// against markup in the public report (spec §7/§9), so it must hold on its own.
export function sanitizeProse(md: string): string {
  // Decode numeric HTML entities first so an entity-encoded tag or scheme (`&#60;script&#62;`,
  // `javascript&#58;…`) is seen by the tag strip and the scheme defang below (review #80, ydimitrof).
  let out = stripTags(decodeNumericEntities(md));
  // Defang dangerous URL schemes a markdown link/image target could carry — `[t](javascript:…)` is NOT
  // inside <…>, so the tag strip misses it, and a markdown renderer would emit an executable href
  // (review #80). javascript:/vbscript: are never legitimate prose (and could autolink), so defang them
  // anywhere; data:/file: are common words, so defang them ONLY inside a markdown link/image target
  // `](…)` to avoid mangling normal prose. This string defang is INHERENTLY INCOMPLETE — a scheme split
  // by whitespace a browser ignores (`java<TAB>script:`, `java&Tab;script:`) slips past it (review #80,
  // red-team R3) — so the Phase-2 renderer MUST allowlist URL schemes (urlTransform → http/https/mailto
  // only) as the AUTHORITATIVE barrier; this string pass is only defence-in-depth until that lands.
  out = out
    .replace(/\b(?:javascript|vbscript)\s*:/gi, 'unsafe:')
    .replace(/(\]\(\s*)(?:data|file)\s*:/gi, '$1unsafe:');
  return out.trim();
}

// Data cells carry submitter-influenceable text (company/authority names, contract subjects). Tag-strip
// string values so no markup survives into the public report even if a renderer forgets to escape —
// defence-in-depth on top of React's default escaping (spec §7). Numbers/null are never markup.
export function sanitizeCell(v: string | number | null): string | number | null {
  return typeof v === 'string' ? sanitizeProse(v) : v;
}

// Guardrail E2 (spec addendum): a DETERMINISTIC check that model prose carries no material number —
// not a prompt rule. The model must place numbers in value slots (totals/table/…) which the server
// binds; a number inside `text`/`callout` is unbound and unverifiable — the "12 млрд." defamation
// vector. Flags currency amounts, magnitude words (млн/млрд/хил.), grouped numbers (1 234 / 1,234,567 /
// 1.234.567) and integers ≥ 5 digits. Bare ≤4-digit numbers (years, small counts, ordinals) pass, to
// keep false positives low.
const PROSE_NUMBER_PATTERNS: RegExp[] = [
  // The digit/sep/space run is BOUNDED ({0,40}). An UNbounded `[\d.,\s]*` before an alternation unit
  // backtracks quadratically on a long run whose unit is absent or at another position (`€` + `9 9 9 …`
  // → O(n²), ~6.7 s on a 64 KB field); dropping a separate trailing `\s*` cut the constant but not the
  // quadratic. The input is also length-capped (gateProse, MAX_PROSE_LEN); bounding the quantifier makes
  // the regex itself linear so findProseNumbers is safe for ANY caller — belt and braces (review #80
  // ReDoS). 40 ≫ any real number's digit/sep/space width, and matchAll still anchors on a digit within
  // 40 chars of the unit, so no legitimate amount is missed.
  /(?:€|eur)\s*\d[\d.,\s]{0,40}/giu, // €1234, EUR 1 234 (currency-first)
  /\d[\d.,\s]{0,40}(?:€|лв\.?|eur|евро|лева)/giu, // 1 234 лв, 1234 евро
  /\d[\d.,\s]{0,40}(?:млн|млрд|хил)\.?/giu, // 12 млрд, 1,2 млн
  // Grouped thousands: 1 234, 1,234,567, 12'000'000, 2٬500٬000 (Arabic sep). The trailing `(?!\d)`
  // requires each group to be EXACTLY three digits — so a four-digit run is not read as a group. Without
  // it a `MM.YYYY` / `DD.MM.YYYY` date (`01.2026`, `01.02.2026`) false-matched as "01.202" (`01` + the
  // first three digits of the year) and rejected legitimate freshness/period prose (date notation is not
  // a material number). A real grouped amount always ends on a 3-digit group, so nothing valid is lost.
  /\d{1,3}(?:[.,\s'’٫٬]\d{3})+(?!\d)/gu,
  /\d(?:[.,]\d+)?[eE][+-]?\d+/gu, // scientific notation: 1.2e10, 12E9
  /\d{5,}/gu, // 10000+ (years are ≤4 digits)
  // Spelled-out magnitudes / percentages / ratios bypassed the digit-only patterns above — a model could
  // write "12 милиарда", "два милиарда", "5 милиона", "95%", "деветдесет процента", "12 на сто",
  // "3,5 пъти" and land an unbound quantity on the public report (review #80). Flag the unit words too.
  // NB: no `\b` adjacent to Cyrillic — JS `\b` is ASCII-`\w`-only, so `\bмилиард` never matches after a
  // space. Match the distinctive stem (covers all inflections: милиард/милиарда/милиарди, …).
  /милиард|милион|хиляд/giu, // spelled magnitudes (incl. word-only "два милиарда", "триста хиляди")
  // Percentages: %, процент-stem, or the idiom "на сто" (= per hundred). The trailing `(?!\p{L})` pins
  // "сто" as a STANDALONE word — without it "на сто" matched the whole "сто" word-family and rejected
  // ordinary procurement prose: "на стойност" (to the value of — ubiquitous), the entity "Столична
  // община", "на стотици". Those are not percentages; "12 на сто" / "на сто%" still match.
  /%|процент|(?<!\p{L})на\s+сто(?!\p{L})/giu,
  /\d[\d.,]*\s*пъти/giu, // numeric ratios (3,5 пъти)
  // Non-€/лв currency units the suffix pattern above omits — a sub-5-digit dollar amount ("5000 долара",
  // "9999 USD", "$1 000") otherwise slips every digit pattern (review #80, follow-up).
  /\d[\d.,\s]{0,40}(?:долар|usd|\$)/giu, // 5000 долара, 9999 USD (currency-after)
  /(?:\$|usd)\s*\d[\d.,\s]{0,40}/giu, // $1234, USD 1 234 (currency-first)
];

const codePoint = (n: number, fallback: string): string =>
  Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;

// Decode numeric HTML entities (`&#58;` / `&#x3a;` / `&#X3A;`) to their character. A markdown renderer
// decodes these, so the sanitizer must see through them before stripping tags / defanging schemes —
// otherwise an entity-encoded tag or scheme (`&#60;script&#62;`, `javascript&#58;…`) survives
// sanitizeProse, the SOLE pre-renderer barrier — and the number gate must decode them before scanning
// (review #80, ydimitrof). The hex form accepts BOTH `&#x..;` and `&#X..;`: HTML5 numeric references are
// case-insensitive on the `x`, so an uppercase `&#X31;` is decoded by renderers too and a case-sensitive
// `x`-only match let it bypass both the number gate and the tag strip (review #80, follow-up).
function decodeNumericEntities(s: string): string {
  // Decode to a FIXPOINT, not a single pass: a double-encoded entity (`1&#38;#50;000` → `1&#50;000` →
  // `12000`) survives one pass — it passes the number gate as `1&#50;000` while a renderer decodes it the
  // rest of the way to a fabricated `12000` (review #80, ydimitrof). Each pass turns an entity into one
  // char so the string strictly shrinks and converges; the iteration bound is a cheap pathology backstop.
  let prev = s;
  for (let i = 0; i < 8; i++) {
    const next = prev
      .replace(/&#(\d{1,7});/g, (m, d) => codePoint(Number(d), m))
      .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (m, h) => codePoint(parseInt(h, 16), m));
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

// Fold every Unicode decimal digit to its ASCII value so the number gate is not blinded by a digit a
// reader still reads as a number — fullwidth (１２), superscript (¹²), circled (⑫), Arabic-Indic,
// Devanagari, … NFKC folds the compatibility forms; the \p{Nd} pass then folds the remaining script
// digits by their position within their (contiguous, 10-wide) Unicode block — value = codepoint − the
// block's zero, found by walking down to the first non-digit (review #80, red-team R1).
function foldDigits(text: string): string {
  return text.normalize('NFKC').replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x30 && cp <= 0x39) return ch; // already ASCII 0-9
    let zero = cp;
    // Cap the down-walk at 9 steps: a decimal-digit block is exactly 10 wide, so the block's zero is ≤9
    // below any digit in it. Without the cap, two ADJACENT \p{Nd} blocks (e.g. the Takri region, whose
    // lower neighbour is also Nd) let the walk cross the boundary and fold an upper-block digit to a
    // wrong multi-digit value (review #80, ultra). Normal isolated blocks are unaffected.
    while (zero > 0 && cp - zero < 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String(cp - zero);
  });
}

// Normalise prose to what a reader/renderer actually sees, so the number gate is not blinded by markup.
// Markdown can split a number from its magnitude word (`**12** **млрд.**` → "12 млрд."); a renderer
// collapses zero-width separators (`1​234​567` → "1234567") and decodes numeric HTML entities
// (`12&#48;&#48;&#48;` → "12000"). Decode/strip those, drop emphasis, collapse whitespace (review #80).
// NB: stripTags here mirrors the display path (sanitizeProse → stripTags). Without it a model can split a
// number with inert tags (`12<x>345<y>678`): the digit run never forms for the patterns above, the gate
// passes, yet sanitizeProse removes the tags and re-joins it to a fabricated "12345678" on the page — the
// §9.1 vector. Decode entities → strip tags → fold digits, so the gate scans the displayed string (#80 f/u).
function deMarkdown(text: string): string {
  return foldDigits(stripTags(decodeNumericEntities(text)))
    .replace(/[\u200b-\u200d\ufeff]/g, '') // zero-width space / non-joiner / joiner / BOM
    .replace(/[*_`~\\]/g, '')
    .replace(/\s+/g, ' ');
}

/** Return the material-number tokens found in prose (empty ⇒ clean). Used to gate text/callout. */
export function findProseNumbers(text: string): string[] {
  const hits: string[] = [];
  // Scan the raw text AND a markdown-stripped copy so neither plain nor markup-split numbers slip.
  for (const scan of [text, deMarkdown(text)]) {
    for (const re of PROSE_NUMBER_PATTERNS) {
      for (const m of scan.matchAll(re)) hits.push(m[0].trim());
    }
  }
  return [...new Set(hits)].filter(Boolean);
}

// Model-authored prose fields are bounded by the generation cap, but the number-gate patterns are
// super-linear, so an unbounded field is a ReDoS vector (review #80). Reject an over-long field instead
// of scanning it — no legitimate label/header/title/callout approaches this. Realistic prose is tiny.
const MAX_PROSE_LEN = 2000;

// THE single material-number gate for every model-authored prose slot (folds the previously open-coded
// copies — a new slot can no longer forget it, review #80). `label` is the slot-specific error prefix.
function gateProse(value: string, label: string, errors: string[]): void {
  if (value.length > MAX_PROSE_LEN) {
    errors.push(`${label}: too long (${value.length} chars); keep prose concise`);
    return; // do NOT scan an over-long string (ReDoS guard)
  }
  const nums = findProseNumbers(value);
  if (nums.length) errors.push(`${label} (${nums.join(', ')})`);
}

// Coerce a charted cell to a number — but ONLY a plain decimal string. `Number()` also parses hex
// (`0x10`→16), scientific (`1e3`→1000) and binary/octal literals, so a TEXT value-column could plot a
// value that diverges from the cited cell (review #80). Numeric D1 columns arrive as `number` already.
// Exported as the SINGLE coercion the renderer (render-format.ts) also uses, so the §9.1 "rendered value
// equals cited cell" rule cannot drift between binder and renderer (review #80, follow-up).
export function asNumber(v: string | number | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(v.trim())) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// A `percent`-formatted cell is a 0..1 ratio by site convention (render-format.formatCell → pct()). A weak
// model sometimes binds a raw euro SUM or a COUNT into a percent-tagged slot (e.g. „Дял по стойност" bound
// to the single-offer euro total instead of its share of the whole), which renders as an absurd
// „1342360573264,6%". This is the SHARED magnitude threshold the binder (reject → model retries) and the
// renderer (safe em-dash) both use, so the two layers can't drift. Generous (10000%) so a legitimate large
// percentage *change* isn't rejected — only values that cannot possibly be a ratio.
export const MAX_RATIO_MAGNITUDE = 100;
export function isImplausibleRatio(v: string | number | null): boolean {
  const n = asNumber(v);
  return n !== null && Math.abs(n) > MAX_RATIO_MAGNITUDE;
}

/**
 * Re-bind a model-emitted report against the server's own result sets. Every number on the page is
 * sourced here from `results`; the model's blocks only select/label/shape. Returns validation
 * errors instead of a report if any reference is dangling — the model then retries (spec §4).
 */
export function bindReport(
  input: EmitReportInput,
  results: QueryResult[],
  opts: BindOptions = {},
): BindResult {
  const errors: string[] = [];
  // Non-fatal issues: missing columns and out-of-range rows render as null rather than blocking the
  // report. The model referenced a valid handle but the column/row wasn't in the actual DB result —
  // the report displays with null in those slots rather than forcing a retry.
  const warnings: string[] = [];
  const byHandle = new Map(results.map((r) => [r.handle, r]));

  const cell = (ref: CellRef, where: string): string | number | null => {
    const r = byHandle.get(ref.resultId);
    if (!r) {
      errors.push(`${where}: unknown result handle "${ref.resultId}"`);
      return null;
    }
    const colIdx = r.columns.indexOf(ref.col);
    if (colIdx < 0) {
      warnings.push(
        `${where}: result "${ref.resultId}" has no column "${ref.col}" — rendered as null`,
      );
      return null;
    }
    // Self-defend against a non-integer row (`1.5`): `1.5 >= length` can be false, then `rows[1.5]` is
    // undefined and the slot would silently bind null. Don't rely on validateEmitShape running first
    // (review #80, ydimitrof).
    if (!Number.isInteger(ref.row) || ref.row < 0 || ref.row >= r.rows.length) {
      warnings.push(
        `${where}: result "${ref.resultId}" row ${ref.row} out of range (0..${r.rows.length - 1}) — rendered as null`,
      );
      return null;
    }
    // Guard the cell access: a ragged row (shorter than columns) would make a non-null assertion lie
    // and surface `undefined`. Real results from toQueryResult are rectangular, so this is defensive.
    const value = r.rows[ref.row]?.[colIdx];
    return value === undefined ? null : value;
  };

  const requireResult = (resultId: string, where: string): QueryResult | null => {
    const r = byHandle.get(resultId);
    if (!r) errors.push(`${where}: unknown result handle "${resultId}"`);
    return r ?? null;
  };

  // Reports missing columns as warnings (not errors) so the block still renders with null values
  // rather than failing the whole report. Returns true so callers always proceed to build the block.
  const requireCols = (r: QueryResult, cols: string[], where: string): true => {
    for (const c of cols) {
      if (!r.columns.includes(c)) {
        warnings.push(`${where}: result "${r.handle}" has no column "${c}" — rendered as null`);
      }
    }
    return true;
  };

  const colValues = (r: QueryResult, col: string) => {
    const i = r.columns.indexOf(col);
    return r.rows.map((row) => row[i] ?? null);
  };

  const blocks: ResolvedBlock[] = [];
  input.blocks.forEach((b, bi) => {
    const at = `block[${bi}] (${b.type})`;
    switch (b.type) {
      case 'text': {
        gateProse(b.md, `${at}: material numbers belong in a value block, not text prose`, errors);
        blocks.push({ type: 'text', md: sanitizeProse(b.md) });
        break;
      }
      case 'callout': {
        const where = `${at}: material numbers belong in a value block, not callout prose`;
        gateProse(b.title, where, errors);
        gateProse(b.md, where, errors);
        blocks.push({ type: 'callout', title: sanitizeProse(b.title), md: sanitizeProse(b.md) });
        break;
      }
      case 'totals':
        blocks.push({
          type: 'totals',
          items: b.items.map((it) => {
            gateProse(
              it.label,
              `${at}: material number in totals label — put it in a value slot`,
              errors,
            );
            const value = sanitizeCell(cell(it.ref, at));
            // A percent slot must reference a 0..1 ratio column, not a raw euro sum/count. Reject an
            // impossible magnitude so the model retries with a real share column (or format 'number').
            if (it.format === 'percent' && isImplausibleRatio(value)) {
              errors.push(
                `${at}: totals item "${it.label}" is format 'percent' but its value (${value}) is not a 0..1 ratio — reference a share column or use format 'number'`,
              );
            }
            // A `totals` item is a HEADLINE aggregate — one "big number". It MUST reference a single-row
            // result (a one-row SUM/COUNT). Binding it to a row of a MULTI-row result silently presents one
            // data point as the whole: the live „Разход по години" report showed „Общ разход 2020–2026:
            // 762,1 млн. €", which was merely the 2020 row — ~61× below the real ~46,6 млрд. € sum. The value
            // is a genuine cell, so no other gate catches it; reject here so the model runs a proper
            // aggregate (SELECT SUM/COUNT …) or moves the figure to a table/timeseries. Highlighting a
            // specific row of a series is what `facts` is for — that block is intentionally exempt.
            const totalsResult = byHandle.get(it.ref.resultId);
            if (totalsResult && totalsResult.rows.length > 1) {
              errors.push(
                `${at}: totals item "${it.label}" references row ${it.ref.row} of a ${totalsResult.rows.length}-row result — a totals figure must come from a single-row aggregate (run a SELECT SUM/COUNT), or present the series as a table/timeseries instead`,
              );
            }
            return {
              label: sanitizeProse(it.label),
              value,
              format: it.format,
            };
          }),
        });
        break;
      case 'facts':
        blocks.push({
          type: 'facts',
          items: b.items.map((it) => {
            gateProse(
              it.term,
              `${at}: material number in facts term — put it in a value slot`,
              errors,
            );
            if (it.sub)
              gateProse(
                it.sub,
                `${at}: material number in facts sub — put it in a value slot`,
                errors,
              );
            return {
              term: sanitizeProse(it.term),
              value: sanitizeCell(cell(it.ref, at)),
              sub: it.sub != null ? sanitizeProse(it.sub) : undefined,
            };
          }),
        });
        break;
      case 'table': {
        const r = requireResult(b.resultId, at);
        if (r) {
          for (const col of b.columns)
            gateProse(col.header, `${at}: material number in column header "${col.key}"`, errors);
          const columns = b.columns.map((c) => ({ ...c, header: sanitizeProse(c.header) }));
          if (r.rows.length === 0) {
            // An empty (0-row) result carries no column metadata, so requireCols would reject every
            // reference and force the model to retry on dangling errors — render an empty table instead
            // (a legitimate "no results" answer; review #80).
            blocks.push({ type: 'table', columns, rows: [], truncated: r.truncated ?? false });
          } else {
            // Require both the display columns AND the link id columns to exist — without the latter an
            // immutable report could not reconstruct its entity links.
            const needed = [
              ...b.columns.map((c) => c.key),
              ...b.columns.flatMap((c) => (c.link ? [c.link.idCol] : [])),
            ];
            if (requireCols(r, needed, at)) {
              const idx = b.columns.map((c) => r.columns.indexOf(c.key));
              const linkIdx = b.columns.map((c) => (c.link ? r.columns.indexOf(c.link.idCol) : -1));
              blocks.push({
                type: 'table',
                columns,
                rows: r.rows.map((row) => ({
                  cells: idx.map((i) => sanitizeCell(row[i] ?? null)),
                  links: linkIdx.map((i) => {
                    const v = i < 0 ? null : row[i];
                    return v == null ? null : String(v);
                  }),
                })),
                truncated: r.truncated ?? false, // surfaced by the renderer; result hit the byte cap (#80)
              });
            }
          }
        }
        break;
      }
      case 'bar': {
        const r = requireResult(b.resultId, at);
        if (r && (r.rows.length === 0 || requireCols(r, [b.labelCol, b.valueCol], at))) {
          const labels = colValues(r, b.labelCol);
          const vals = colValues(r, b.valueCol);
          const points: { label: string | number | null; value: number }[] = [];
          for (let i = 0; i < labels.length; i++) {
            const value = asNumber(vals[i] ?? null);
            if (value !== null) points.push({ label: sanitizeCell(labels[i] ?? null), value });
          }
          blocks.push({ type: 'bar', points, truncated: r.truncated ?? false, format: b.format });
        }
        break;
      }
      case 'flows': {
        const r = requireResult(b.resultId, at);
        if (r && (r.rows.length === 0 || requireCols(r, [b.fromCol, b.toCol, b.valueCol], at))) {
          const from = colValues(r, b.fromCol);
          const to = colValues(r, b.toCol);
          const val = colValues(r, b.valueCol);
          const edges: { from: string; to: string; valueEur: number }[] = [];
          for (let i = 0; i < from.length; i++) {
            const valueEur = asNumber(val[i] ?? null);
            if (valueEur !== null)
              edges.push({
                from: sanitizeProse(String(from[i] ?? '')),
                to: sanitizeProse(String(to[i] ?? '')),
                valueEur,
              });
          }
          blocks.push({ type: 'flows', edges, truncated: r.truncated ?? false });
        }
        break;
      }
      case 'timeseries': {
        const r = requireResult(b.resultId, at);
        if (r && (r.rows.length === 0 || requireCols(r, [b.periodCol, b.valueCol], at))) {
          const period = colValues(r, b.periodCol);
          const vals = colValues(r, b.valueCol);
          const points: { period: string | number | null; value: number }[] = [];
          for (let i = 0; i < period.length; i++) {
            const value = asNumber(vals[i] ?? null);
            if (value !== null) points.push({ period: sanitizeCell(period[i] ?? null), value });
          }
          blocks.push({
            type: 'timeseries',
            points,
            truncated: r.truncated ?? false,
            format: b.format,
          });
        }
        break;
      }
    }
  });

  if (!input.title.trim()) errors.push('report title is empty');
  gateProse(
    input.title,
    'report title: material number in title — put it in a value block',
    errors,
  );
  // The displayed question is server-owned when the route supplies the real user text (the user's own
  // question may legitimately carry numbers — it is not a model claim). Only the model-authored
  // fallback is number-gated, so a model cannot smuggle an unbound number through the question slot.
  const serverQuestion = opts.question?.trim() ? opts.question : undefined;
  if (serverQuestion === undefined) {
    gateProse(
      input.question,
      "report question: material number in question — the server fills it from the user's message",
      errors,
    );
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    report: {
      title: sanitizeProse(input.title.trim()),
      question: sanitizeProse(serverQuestion ?? input.question),
      blocks,
      watermark: 'ai-generated',
    },
    warnings,
  };
}
